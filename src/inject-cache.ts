import { promises as fs } from "fs";
import path from 'path';
import { CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath, getUID, getGID, getBuilder, assertSingleLine, shellQuote } from './opts.js';
import { run } from './run.js';
import { notice } from '@actions/core/lib/core.js';

async function injectCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string) {
    // Clean Scratch Directory
    await fs.rm(scratchDir, { recursive: true, force: true });
    await fs.mkdir(scratchDir, { recursive: true });

    // Prepare Cache Source Directory
    await fs.mkdir(cacheSource, { recursive: true });

    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(cacheSource, 'buildstamp'), date);

    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    // Values below are interpolated into the generated Dockerfile, and
    // targetPath/uid/gid additionally end up in a `sh -c` command run by
    // `RUN`, so they must not contain newlines (Dockerfile instruction
    // injection) and must be shell-quoted (command injection).
    assertSingleLine(containerImage, 'utility-image');
    assertSingleLine(mountArgs, 'cache-map mount arguments');
    assertSingleLine(targetPath, 'cache-map target');

    // If UID OR GID are set, then add chown to restore files ownership.
    let ownershipCommand = "";
    const uid = getUID(cacheOptions);
    const gid = getGID(cacheOptions);
    if (uid !== "" || gid !== "") {
        ownershipCommand = `&& chown -R ${shellQuote(uid)}:${shellQuote(gid)} ${shellQuote(targetPath)}`
    }

    // Prepare Dancefile to Access Caches
    const dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    --mount=type=bind,source=.,target=/var/dance-cache \
    cp -p -R /var/dance-cache/. ${shellQuote(targetPath)} ${ownershipCommand} || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.inject'), dancefileContent);
    console.log(dancefileContent);

    // Inject Data into Docker Cache
    await run('docker', ['buildx', 'build', ...(builder ? ['--builder', builder] : []), '-f', path.join(scratchDir, 'Dancefile.inject'), '--tag', 'dance:inject', cacheSource]);    
    // Clean Directories
    try {
        await fs.rm(cacheSource, { recursive: true, force: true });
    } catch (err) {
        // Ignore Cleaning Errors
        notice(`Error while cleaning cache source directory: ${err}. Ignoring...`);
    }
}


export async function injectCaches(opts: Opts) {
    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];

    const builder = getBuilder(opts);
    // Inject Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await injectCache(cacheSource, cacheOptions, scratchDir, containerImage, builder);
    }
}
