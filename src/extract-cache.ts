import { promises as fs } from 'fs';
import path from 'path';
import { CacheOptions, Opts, getBuilder, getCacheMap, getMountArgsString, getTargetPath, assertSingleLine, shellQuote } from './opts.js';
import { run, runPiped } from './run.js';

/**
 * Reject cache source paths that resolve to well-known system directories,
 * as a guard against `sudo rm -rf` deleting more than the intended cache
 * directory if `cache-map` ever contains an unexpected value.
 */
function assertSafeCachePath(cacheSource: string): void {
    const resolved = path.resolve(cacheSource);
    const dangerousPaths = ['/', '/root', '/home', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/boot', '/opt', '/proc', '/sys', '/dev'];
    if (dangerousPaths.includes(resolved)) {
        throw new Error(`Refusing to delete potentially dangerous cache path: ${resolved}`);
    }
}

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string) {
    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();

    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    // Values below are interpolated into the generated Dockerfile, and
    // targetPath additionally ends up in a `sh -c` command run by `RUN`,
    // so they must not contain newlines (Dockerfile instruction injection)
    // and must be shell-quoted (command injection).
    assertSingleLine(containerImage, 'utility-image');
    assertSingleLine(mountArgs, 'cache-map mount arguments');
    assertSingleLine(targetPath, 'cache-map target');

    const dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    mkdir -p /var/dance-cache/ \
    && cp -p -R ${shellQuote(targetPath)}/. /var/dance-cache/ || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    // Extract Data into Docker Image
    await run('docker', ['buildx', 'build', ...(builder ? ['--builder', builder] : []), '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', 'dance:extract', '--load', scratchDir]);

    // Create Extraction Image
    try {
        await run('docker', ['rm', '-f', 'cache-container']);
    } catch (error) {
        // Expected if the container does not exist yet; log for visibility
        // in case it's actually a permission or daemon issue.
        console.log(`Note: failed to remove existing cache-container (expected if it doesn't exist): ${error}`);
    }
    await run('docker', ['create', '-ti', '--name', 'cache-container', 'dance:extract']);

    // Unpack Docker Image into Scratch
    await runPiped(
        ['docker', ['cp', '-L', 'cache-container:/var/dance-cache', '-']],
        ['tar', ['-H', 'posix', '-x', '-C', scratchDir]]
    );

    // Move Cache into Its Place
    assertSafeCachePath(cacheSource);
    await run('sudo', ['rm', '-rf', cacheSource]);
    await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];
    const builder = getBuilder(opts);

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir, containerImage, builder);
    }
}
