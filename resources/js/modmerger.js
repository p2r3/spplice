function findScriptGlobals (script, found = []) {

  const slotdef = script.split("<-").slice(0, -1);
  const vchar = /[A-Za-z0-9_]/;

  let idxoffset = 0;

  for (let i = 0; i < slotdef.length; i++) {

    const curr = slotdef[i];
    idxoffset += curr.length + 2;
    let startidx = null, endidx = null;

    for (let j = curr.length - 1; j >= 0; j--) {

      if (curr[j] === ']' || curr[j] === '.') break;

      if (endidx === null) {
        if (curr[j].match(vchar)) endidx = j + 1;
      } else if (!curr[j].match(vchar)) {
        startidx = j + 1;
        break;
      }

    }

    if (startidx === null || endidx === null) continue;

    let scope = 0;
    if (curr.slice(startidx - 2, startidx) !== "::" && !curr[startidx - 3].match(vchar)) {

      let nostr = script.slice(0, idxoffset);
      while (nostr.indexOf('\\\\') !== -1) nostr = nostr.replace(/\\\\/g, "");
      while (nostr.indexOf('\\"') !== -1) nostr = nostr.replace(/\\"/g, "");

      nostr = nostr.split('"');
      for (let j = 0; j < nostr.length; j += 2) {
        scope += nostr[j].split('{').length;
        scope -= nostr[j].split('}').length;
      }

    }

    if (scope === 0) {
      const variable = curr.slice(startidx, endidx);
      if (!found.includes(variable)) found.push(variable);
    }

  }

  return found;

}

async function findScriptGlobalsDirectory (path, found = []) {

  const dir = await Neutralino.filesystem.readDirectory(path);

  for (let i = 0; i < dir.length; i++) {

    if (dir[i].type === "FILE") {
      if (dir[i].entry.endsWith(".nut")) {

        const data = await Neutralino.filesystem.readFile(`${path}${S}${dir[i].entry}`);
        found.concat(findScriptGlobals(data, found));

      }
    } else if (dir[i].entry !== "." && dir[i].entry !== "..") {

      found.concat(findScriptGlobalsDirectory(`${path}${S}${dir[i].entry}`, found));

    }

  }

  return found;

}

function renameScriptGlobals (script, variables, append) {

  const vchar = /[A-Za-z0-9_]/;

  for (let i = 0; i < variables.length; i++) {

    const curr = variables[i];
    script = script.split(curr);

    let j = 0;
    while (j < script.length - 1) {

      if (script[j].length === 0) continue;
      if (script[j + 1].length === 0) continue;

      if (
        !script[j][script[j].length - 1].match(vchar) &&
        !script[j + 1][0].match(vchar)
      ) {
        script[j] += `${curr}_${append}${script[j + 1]}`;
        script.splice(j + 1, 1);
      } else j++;

    }

    script = script.join(curr);

  }

  return script;

}

async function renameScriptGlobalsDirectory (path, globals, append) {

  const dir = await Neutralino.filesystem.readDirectory(path);

  for (let i = 0; i < dir.length; i++) {

    if (dir[i].type === "FILE") {
      if (dir[i].entry.endsWith(".nut")) {

        const filename = `${path}${S}${dir[i].entry}`;

        const data = "\n" + await Neutralino.filesystem.readFile(filename);
        await Neutralino.filesystem.writeFile(filename, renameScriptGlobals(data, globals, append));
      
      }
    } else if (dir[i].entry !== "." && dir[i].entry !== "..") {

      await renameScriptGlobalsDirectory(`${path}${S}${dir[i].entry}`, globals, append);

    }

  }

}

async function mergeDirectory (gpath, root, path, mergeidx) {

  const dir = await Neutralino.filesystem.readDirectory(root + path);

  for (let i = 0; i < dir.length; i++) {

    const source = `${root}${path}${dir[i].entry}`;
    const destination = `${gpath}${path}${dir[i].entry}`;

    if (dir[i].type === "FILE") {

      if (dir[i].entry.endsWith(".nut")) {

        const data = await Neutralino.filesystem.readFile(source);
        await Neutralino.filesystem.appendFile(destination, data);

      } else {

        try { await Neutralino.filesystem.removeFile(destination) } catch (e) { }
        await Neutralino.filesystem.moveFile(source, destination);

      }

    } else if (dir[i].entry !== "." && dir[i].entry !== "..") {

      try {
        await Neutralino.filesystem.readDirectory(destination);
      } catch (e) {
        await Neutralino.filesystem.createDirectory(destination);
      }

      await mergeDirectory(gpath, root, `${path}${dir[i].entry}${S}`, mergeidx);

    }

  }

}

async function mergeMods(p2path, packageIDs) {

  // Ensure that portal2_tempcontent is ready for package extraction
  const gpath = `${p2path}${S}portal2_tempcontent`;
  await tempcontentSetup(gpath);

  // The first loop installs all packages as per usual
  for (let i = 0; i < packageIDs.length; i++) {

    const path = gpath + `${S}.spplice_merge${i}`;
    const packageID = packageIDs[i];

    await Neutralino.filesystem.createDirectory(path);

    // Get package repository URL
    const currPackage = index.packages[packageID];
    const url = `http://${REPO}/spplice/packages/${currPackage.name}/${currPackage.file}`;

    // Download (or copy) package
    var pkg = `${path}${S}spp.tar.gz`;
    if (!("local" in currPackage) || !currPackage.local) {

      const curl = await Neutralino.os.execCommand(`${CURL} -s ${url} -o"${pkg}"`);
      if (curl.exitCode !== 0) {
        Neutralino.os.showMessageBox(
          "Installation failed",
          "Failed to download package",
          "OK",
          "ERROR"
        );
        return;
      }

    } else {

      const path = `${NL_PATH}/custom/${currPackage.name}/${currPackage.file}`;
      try { await Neutralino.filesystem.copyFile(path, pkg) }
      catch (e) {
        Neutralino.os.showMessageBox(
          "Installation failed",
          "Failed to copy local package: " + JSON.stringify(e),
          "OK",
          "ERROR"
        );
        return;
      }

    }

    // Install package
    try {
      const tar = await Neutralino.os.execCommand(`${TAR} -xzf "${pkg}" -C "${path}"`);
      if (tar.exitCode !== 0) throw tar.stdErr;
      await Neutralino.filesystem.removeFile(pkg);
    } catch (e) {
      if (typeof e === "object") e = JSON.stringify(e);
      Neutralino.os.showMessageBox(
        "Installation failed",
        "Failed to extract archive: " + e,
        "OK",
        "ERROR"
      );
      return;
    }

  }

  setStatusText("Merging packages...");

  // The second loop solves conflicts between similar files
  for (let i = 0; i < packageIDs.length; i++) {

    const path = gpath + `${S}.spplice_merge${i}`;

    const globals = await findScriptGlobalsDirectory(path);
    await renameScriptGlobalsDirectory(path, globals, `spplice_merge${i}`);

    await mergeDirectory(gpath, path, S, i);
    await forceRemoveDirectory(path);

  }

}
