// Simple Portal 2 Package Loading Instrument for Convenient External modding

var game = {}, steam = {};
Neutralino.init();

async function getGameDirectory(steamPath) {

  try {

    const dirs = (await Neutralino.filesystem.readFile(`${steamPath}/steamapps/libraryfolders.vdf`)).split('"path"');

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

  } catch (e) {
    
    if (typeof e === "object") e = JSON.stringify(e);
    Neutralino.os.showMessageBox(
      "Failed to find Portal 2",
      "An error occured while parsing Steam library data: " + e,
      "OK",
      "ERROR"
    );

  }

  return false;

}

async function killGame() {

  switch (NL_OS) {
    // case "Windows": await Neutralino.os.execCommand('wmic process where name="portal2.exe" delete');
    case "Linux"  : await Neutralino.os.execCommand('pkill -9 "portal2_linux"');
    case "Darwin" : await Neutralino.os.execCommand('pkill -9 "portal2_osx"');
  }

}

async function getSteamDirectory() {

  try {

    if (NL_OS === "Windows") {
  
      const reg = (await Neutralino.os.execCommand(`${REG} query HKCU\\SOFTWARE\\Valve\\Steam /v SteamPath`)).stdOut;
      return reg.split("REG_SZ    ").slice(1).join("REG_SZ    ").split("\r\n")[0].replace(/\//g, "\\");
  
    } else  {

      const home = (await Neutralino.os.execCommand("echo $HOME")).stdOut.split("\n")[0];
      
      const paths = [
        "/.steam/steam",
        "/.local/share/Steam",
        "/Library/Application Support/Steam",
        "/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps"
      ];
      
      for (let i = 0; i < paths.length; i ++) {
        
        try {
          const curr = home + paths[i];
          await Neutralino.filesystem.readDirectory(curr);
          return curr;
        } catch (e) {}

      }

    }

  } catch (e) {

    if (typeof e === "object") e = JSON.stringify(e);
    Neutralino.os.showMessageBox(
      "Failed to find Steam",
      "An error occured while looking for the Steam installation: " + e,
      "OK",
      "ERROR"
    );

  }

  return false;

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
  
    await Neutralino.filesystem.createDirectory(path + "/maps");
    await Neutralino.filesystem.createDirectory(path + "/maps/soundcache");
    await Neutralino.filesystem.copyFile(path + "/../portal2/maps/soundcache/_master.cache", path + "/maps/soundcache/_master.cache");

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

var gameStartInterval, gameCloseInterval;

async function launchMod(packageID) {

  hideInfo();
  setActivePackage(-1);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  setStatusText("Looking for Steam...");
  const steamPath = await getSteamDirectory();

  if (!steamPath) {

    setStatusText("Steam is not installed", true);
    return;

  }

  setStatusText("Looking for Portal 2...");
  const gamePath = await getGameDirectory(steamPath);

  if (!gamePath) {

    setStatusText("Portal 2 is not installed, try restarting Steam", true);
    return;

  }

  setStatusText("Cleaning up...");

  try { await Neutralino.filesystem.removeFile(`${gamePath}/portal2/cfg/spplicetmp.cfg`) } catch (e) { }
  try { await Neutralino.filesystem.removeFile(`${steamPath}/GameOverlayRenderer.log`) } catch (e) { }
  try { await Neutralino.filesystem.removeFile(`${NL_PATH}/steam.log`) } catch (e) { }
  try { await killGame() } catch (e) { }

  if (packageID < 0) setStatusText("Uninstalling package...");
  else setStatusText("Installing package...");

  await installMod(gamePath, packageID);

  if (packageID < 0) {
    setStatusText("Mods cleared", true);
    return;
  }

  setStatusText("Starting Portal 2...");

  if (NL_OS === "Windows") {
    Neutralino.os.execCommand(`${PWSH} Start-Process '${steamPath}${S}steam.exe' '-applaunch 620 -tempcontent +host_writeconfig spplicetmp' -Verb runAs`, { background: true });
  } else {
    Neutralino.os.execCommand(`steam -applaunch 620 -tempcontent +host_writeconfig spplicetmp > ${NL_PATH}/steam.log`, { background: true });
  }

  setActivePackage(packageID);

  // Check if game is running
  gameStartInterval = setInterval(function () {

    Neutralino.filesystem.removeFile(`${gamePath}/portal2/cfg/spplicetmp.cfg`).then(async function () {

      setStatusText("Portal 2 started", true);
      clearInterval(gameStartInterval);

      // HACK: Detecting the game closing is unreliable on Windows.
      // It's better to just skip this step entirely for now.
      if (NL_OS === "Windows") return;

      // Handle game closing
      gameCloseInterval = setInterval(async function () {
        
        if (NL_OS === "Windows") {

          const log = await Neutralino.filesystem.readFile(`${steamPath}/GameOverlayRenderer.log`);
          if (log.split("GameID = 620").slice(-1)[0].indexOf("Detaching input hook...") === -1) return;
          
        } else {
          
          const log = await Neutralino.filesystem.readFile(`${NL_PATH}/steam.log`);
          if (log.indexOf('Game.dll loaded for "Half-Life 2"') === -1) return;
          
        }

        clearInterval(gameCloseInterval);
        Neutralino.filesystem.removeFile(`${NL_PATH}/steam.log`);

        setStatusText("Portal 2 closed", true);
        setActivePackage(-1);
        installMod(gamePath, -1);

      }, 1000);

    }, function(){});

  }, 500);

}

function launchModFromName(name) {

  const matchName = (element) => element.name === name;
  const packageID = index.packages.findIndex(matchName);

  if (packageID === -1) {
    console.warn("Invalid mod name provided, assuming uninstall.");
  }

  launchMod(packageID);

}

async function shutdownSpplice() {

  setStatusText("Shutting down Spplice...", true);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  if (activePackage !== -1) await killGame();
  if ("path" in game) await installMod(gamePath, -1);

  Neutralino.app.exit();

}

Neutralino.events.on("windowClose", function() {

  shutdownSpplice();

});
