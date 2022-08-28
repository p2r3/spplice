// Simple Portal 2 Package Loading Instrument for Convenient External modding

var game = {}, steam = {};
Neutralino.init();

async function getGameDirectory(steamPath) {

  const dirs = (await Neutralino.filesystem.readFile(steamPath + "steamapps/libraryfolders.vdf")).split('"path"');

  for (let i = 1; i < dirs.length; i++) {
    if (dirs[i].split('"apps"')[1].indexOf('"620"') !== -1) {

      return dirs[i].split('"') // Isolate properties
        .slice(1) // Jump to start of path 
        .join('"') // Rebuild string in case path has quotes
        .split("\n")[0] // Include only this line
        .slice(0, -1) // Remove last quote
        .replace(/\\\\/g, "\\") // Fix double backslashes on Windows
        .replace(/\\"/g, '"') // Fix escaped quotes in path
        + `${S}steamapps${S}common${S}Portal 2`; // Add Portal 2 directory

    }
  }

}

async function getGameProcessInfo() {

  switch (NL_OS) {

    case "Windows": {

      const pwsh = Neutralino.os.execCommand(`powershell -command "Get-Process 'portal2' | Format-List Id"`);
      const timeout = new Promise (function (resolve) {
        setTimeout(resolve, 5000, { stdOut: "" });
      });
      
      const out = (await Promise.race( [timeout, pwsh] )).stdOut;
      if (out.indexOf("Id : ") === -1) return 0;
      return Number( out.split("Id : ")[1].split("\n")[0] );

    }

    default: {

      var bin = "portal2_linux";
      if (NL_OS === "Darwin") bin = "portal2_osx";

      return Number( (await Neutralino.os.execCommand(`pgrep -f ${bin} | grep -Fsv $$`)).stdOut.split("\n")[0] );

    }
    
  }

}

async function getSteamProcessInfo() {

  const curr = {
    cmd: "",
    path: "",
    pid: 0
  };

  switch (NL_OS) {
    case "Windows": {

      const pwsh = (await Neutralino.os.execCommand(`powershell -command "Get-Process 'steam' | Format-List Id,Path"`)).stdOut;
      const entries = pwsh.split("\n");

      for (let i = 0; i < entries.length; i++) {
        const currVal = entries[i].slice(entries[i].indexOf(" : ") + 3);
        if (entries[i].startsWith("Id")) curr.pid = Number(currVal);
        else if (entries[i].startsWith("Path")) {
          curr.cmd = `"${currVal}"`;
          curr.path = currVal.slice(0, -10);
        }
      }

      break;

    }
    default: {

      const pgrep = (await Neutralino.os.execCommand(`pgrep -af steam`)).stdOut.split("\n");

      let proc = null;
      for (let i = 0; i < pgrep.length; i++) {
        if (pgrep[i].endsWith("/steam") || pgrep[i].indexOf("/steam ") > -1) {
          proc = pgrep[i];
          break;
        }
      }
      if (!proc) break;

      let proc_split = proc.split(" ");
      curr.pid = Number(proc_split.shift());

      proc_split = proc_split.join(" ").split("/steam");
      proc_split.pop();
      curr.cmd = proc_split.join("/steam") + "/steam";

      const pwdx = (await Neutralino.os.execCommand(`pwdx ${curr.pid}`)).stdOut;
      curr.path = pwdx.slice(pwdx.indexOf(": ") + 2, -1) + "/";

      let env = (await Neutralino.os.execCommand(`ps eww ${curr.pid}`)).stdOut.replace(/\n/g, " ");
      env = env.split(curr.cmd);
      env.shift();
      env = env.join(curr.cmd).split("=");

      let envstr = "";
      for (let i = 0; i < env.length - 1; i ++) {
        let currVar = env[i].split(" ");
        let currVal = env[i+1].split(" ");
        currVar = currVar[currVar.length - 1];
        if (currVal.length === 1) {
          let nextVar = env[i++].split(" ");
          nextVar = nextVar[nextVar.length - 1];
          currVal = [`${currVal[0]}=${nextVar}`];
        } else if (i < env.length - 2) currVal.pop();
        currVal = currVal.join(" ");
        envstr += `export ${currVar}="${currVal}";`;
      }
      curr.cmd = `${envstr} "${curr.cmd}"`;

      break;

    }
  }

  return curr;

}

async function installMod(p2path, packageID) {

  // Ensure that portal2_tempcontent is ready for package extraction
  const path = `${p2path}${S}portal2_tempcontent`;
  try {
    const curr = await Neutralino.filesystem.readDirectory(path);
    try {

      if (curr.length !== 2) {
        await Neutralino.filesystem.readFile(path + "/.spplice_tmp");
        await forceRemoveDirectory(path);
      }

    } catch (e) {

      let tmpNum = 0, tmpPath = p2path + "/.spplice_tmpcontent_backup";

      try { await Neutralino.filesystem.createDirectory(tmpPath) }
      catch (e) { tmpNum = (await Neutralino.filesystem.readDirectory(tmpPath)).length - 2 }

      await Neutralino.filesystem.moveFile(`${p2path}/portal2_tempcontent`, `${tmpPath}/portal2_tempcontent_${tmpNum}`);

    }
  } catch (e) {}

  // Uninstall and exit
  if (packageID < 0) return;

  // Get package repository URL
  const currPackage = index.packages[packageID];
  const url = `http://${REPO}/spplice/packages/${currPackage.name}/${currPackage.file}`;

  try {

    try { await Neutralino.filesystem.readDirectory(path) }
    catch (e) { await Neutralino.filesystem.createDirectory(path) }
    
    try { await Neutralino.filesystem.readFile(path + "/.spplice_tmp") }
    catch (e) { await Neutralino.filesystem.writeFile(path + "/.spplice_tmp", "") }
  
    await Neutralino.filesystem.createDirectory(path + "/maps").catch();
    await Neutralino.filesystem.createDirectory(path + "/maps/soundcache").catch();
    await Neutralino.filesystem.copyFile(path + "/../portal2/maps/soundcache/_master.cache", path + "/maps/soundcache/_master.cache").catch();

  } catch (e) {

    const adminName = (NL_OS === "Windows" ? "Administrator" : "root");

    Neutralino.os.showMessageBox(
      "Installation failed",
      `Failed to write installation files. This is probably a permissions issue - try running Spplice as ${adminName}.`,
      "OK",
      "ERROR"
    );
    return;

  }

  // Download (or copy) package
  var pkg = `${path}${S}spp.tar.gz`;
  if (!("local" in currPackage) || !currPackage.local) {

    const curl = await Neutralino.os.execCommand(`curl -s ${url} -o"${pkg}"`);
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
    const tar = await Neutralino.os.execCommand(`tar -xzf --force-local "${pkg}" -C "${path}"`);
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

var gameStartInterval, gameCloseInterval;

async function launchMod(packageID) {

  hideInfo();
  setActivePackage(-1);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  setStatusText("Looking for Steam...");

  // Gets PID, current path and command line
  steam = await getSteamProcessInfo();

  if (!steam.pid) {

    setStatusText("Steam is not running", true);
    return;

  }

  setStatusText("Looking for Portal 2...");

  game.pid = await getGameProcessInfo();
  if (!("path" in game)) {
    game.path = await getGameDirectory(steam.path);
  }

  if (game.pid) {

    setStatusText("Closing Portal 2...");

    if (NL_OS === "Windows") await Neutralino.os.execCommand(`powershell -command "Stop-Process -Id ${game.pid}"`);
    else await Neutralino.os.execCommand(`kill ${game.pid}`);
    
  }

  setStatusText("Installing package...");

  await installMod(game.path, packageID);

  setStatusText("Starting Portal 2...");

  await Neutralino.os.execCommand(`${steam.cmd} -applaunch 620 ${packageID < 0 ? "" : "-tempcontent"} ${NL_OS !== "Windows" ? "&" : ""}`, { background: true });

  setActivePackage(packageID);

  // Check if game is running
  gameStartInterval = setInterval(async function() {

    if (await getGameProcessInfo()) {

      setStatusText("Portal 2 started", true);
      clearInterval(gameStartInterval);

      // Handle game closing
      gameCloseInterval = setInterval(async function() {
        if (!(await getGameProcessInfo())) {

          clearInterval(gameCloseInterval);

          setStatusText("Portal 2 closed", true);
          setActivePackage(-1);
          installMod(game.path, -1);

        }
      }, 1500);

    }
  }, 3000);

}

async function shutdownSpplice() {

  setStatusText("Shutting down Spplice...", true);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  if (activePackage !== -1) {
    const currPID = await getGameProcessInfo();
    if (NL_OS === "Windows") await Neutralino.os.execCommand(`powershell -command "Stop-Process -Id ${currPID}"`);
    else await Neutralino.os.execCommand(`kill ${currPID}`);
  }

  if ("path" in game) await installMod(game.path, -1);

  Neutralino.app.exit();

}

Neutralino.events.on("windowClose", function () {
  shutdownSpplice();
});
