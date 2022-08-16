// Simple Portal 2 Package Loading Instrument for Convenient External modding

var game = {};
Neutralino.init();

async function installMod(path, packageID) {

  // Ensure that portal2_tempcontent is ready for package extraction
  path += "portal2_tempcontent";
  try {
    const curr = await Neutralino.filesystem.readDirectory(path);
    try {
      if(curr.length != 2) {
        await Neutralino.filesystem.getStats(path + "/.spplice_tmp");
        await forceRemoveDirectory(path);
      }
    } catch (e) {
      Neutralino.os.showMessageBox(
        "Installation failed",
        "Spplice requires an empty tempcontent directory!",
        "OK",
        "ERROR"
      );
      return;
    }
  } catch (e) {}

  // Unistall and exit
  if(packageID < 0) return;

  // Get package repository URL
  const currPackage = index.packages[packageID];
  const url = `https://p2r3.com/spplice/packages/${currPackage.name}/${currPackage.file}`;

  await Neutralino.filesystem.createDirectory(path);
  await Neutralino.filesystem.writeFile(path + "/.spplice_tmp", "");

  await Neutralino.filesystem.createDirectory(path + "/maps");
  await Neutralino.filesystem.createDirectory(path + "/maps/soundcache");
  await Neutralino.filesystem.copyFile(path + "/../portal2/maps/soundcache/_master.cache", path + "/maps/soundcache/_master.cache");

  // Download (or copy) package
  var pkg = path + "/spp.tar.gz";
  if(!("local" in currPackage) || !currPackage.local) {

    const curl = await Neutralino.os.execCommand(`curl -s ${url} -o"${pkg}"`);
    if(curl.exitCode !== 0) {
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
    await Neutralino.os.execCommand(`tar -xzf "${pkg}" -C "${path}"`);
    await Neutralino.filesystem.removeFile(pkg);
  } catch (e) {
    setStatusText("Failed to install package", true);
    console.log(e);
    return;
  }

}

function gameClosed(evt) {
  if(game.nid === evt.detail.id && evt.detail.action === "exit") {
    setStatusText("Portal 2 closed", true);
    setActivePackage(-1);
    installMod(game.path, -1);
    delete game.nid;
  }
}

async function failedGameKill() {

  await Neutralino.os.showMessageBox(
    "Shutdown failed",
    "Spplice was unable to close Portal 2. Please do so manually and close this prompt to continue with the installation.",
    "OK",
    "ERROR"
  );

}

async function launchMod(packageID) {

  hideInfo();

  Neutralino.events.off("spawnedProcess", gameClosed);

  setStatusText("Looking for Portal 2...");

  // Get game PID, command line and path if we don't already have them
  if(!("nid" in game)) switch (NL_OS) {
    case "Windows": {
      game.exe = "portal2.exe";
      let pwsh = (await Neutralino.os.execCommand(`powershell -command "Get-CimInstance Win32_Process | where Name -eq 'portal2.exe' | Format-List ProcessId,Path,CommandLine"`)).stdOut;
      let entries = pwsh.split("\n");
      for(let i = 0; i < entries.length; i++) {
        let currVal = entries[i].slice(entries[i].indexOf(" : ") + 3);
        if(entries[i].startsWith("ProcessId")) game.pid = Number(currVal);
        else if(entries[i].startsWith("Path")) game.path = currVal.slice(0, -game.exe.length-1);
        else if(entries[i].startsWith("CommandLine")) game.cmd = currVal;
      }
      game.env = {};
      break;
    }
    default: {
      if(NL_OS === "Darwin") game.exe = "portal2_osx";
      else game.exe = "portal2_linux";
      let pgrep = (await Neutralino.os.execCommand(`pgrep -af ${game.exe} | grep -v $$`)).stdOut.split("\n")[0];
      if(pgrep.length == 0) break;
      let pgrep_split = pgrep.split(" ");
      game.pid = Number(pgrep_split.shift());
      game.cmd = pgrep_split.join(" ");
      let pwdx = (await Neutralino.os.execCommand(`pwdx ${game.pid}`)).stdOut;
      game.path = pwdx.slice(pwdx.indexOf(": ") + 2, -1) + "/";
      let env = (await Neutralino.os.execCommand(`ps eww ${game.pid}`)).stdOut.replace(/\n/g, " ").split(game.cmd)[1].split("=");
      game.env = {};
      for(let i = 0; i < env.length - 1; i ++) {
        let currVar = env[i].split(" ");
        currVar = currVar[currVar.length - 1];
        let currVal = env[i+1].split(" ");
        if(currVal.length == 1) {
          let nextVar = env[i++].split(" ");
          nextVar = nextVar[nextVar.length - 1];
          currVal = [`${currVal[0]}=${nextVar}`];
        } else if (i < env.length - 2) currVal.pop();
        currVal = currVal.join(" ");
        game.env[currVar] = currVal;
      }
      game.cmd = game.cmd.replace(game.path + game.exe, `"${game.path + game.exe}"`);
      break;
    }
  }

  console.log(game);

  if(!game.pid) return setStatusText("Portal 2 is not running", true);
  if(!("path" in game) || game.path.length < game.exe.length) return setStatusText("Could not find game path!");

  setStatusText("Closing Portal 2...");

  // Kill existing game process
  if("nid" in game) try{ await Neutralino.os.updateSpawnedProcess(game.nid, "exit") } catch(e) { await failedGameKill() }
  else if(NL_OS === "Windows") await Neutralino.os.execCommand(`powershell -command "Stop-Process -Id ${game.pid}"`);
  else await Neutralino.os.execCommand(`kill ${game.pid}`);
  console.log("Killing PID " + game.pid);

  setStatusText("Installing package...");

  await installMod(game.path, packageID);

  setStatusText("Starting Portal 2...");

  // Start new game process
  var newProcess;
  switch (NL_OS) {
    case "Windows": {
      newProcess = await Neutralino.os.spawnProcess(game.cmd);
      break;
    }
    default: {
      let command = `cd "${game.path}";`;
      for(const curr in game.env) {
        command += `export ${curr}="${game.env[curr]}";`;
      }
      command += game.cmd + " -tempcontent";
      newProcess = await Neutralino.os.spawnProcess(command);
      break;
    }
  }
  game.nid = newProcess.id;

  setActivePackage(packageID);

  // Handle game closing
  setTimeout(function () {
    setStatusText("Portal 2 started", true);
    Neutralino.events.on("spawnedProcess", gameClosed);
  }, 3000);

}

async function shutdownSpplice() {
  setStatusText("Shutting down Spplice...", true);
  if(typeof game === "object") {
    if("nid" in game) try{ await Neutralino.os.updateSpawnedProcess(game.nid, "exit") } catch(e) { await failedGameKill() };
    if("path" in game) await installMod(game.path, -1);
  }
  Neutralino.app.exit();
}

Neutralino.events.on("windowClose", function () {
  shutdownSpplice();
});
