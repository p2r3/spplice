// Simple Portal 2 Package Loading Instrument for Convenient External modding

var game = {}, steam = {};
Neutralino.init();

async function getGameProcessInfo() {

  const curr = {
    path: "",
    pid: 0
  };

  switch (NL_OS) {
    case "Windows": {
      const pwsh = (await Neutralino.os.execCommand(`powershell -command "Get-Process 'portal2' | Format-List Id,Path"`)).stdOut;
      const entries = pwsh.split("\n");
      for(let i = 0; i < entries.length; i++) {
        const currVal = entries[i].slice(entries[i].indexOf(" : ") + 3);
        if(entries[i].startsWith("Id")) curr.pid = Number(currVal);
        else if(entries[i].startsWith("Path")) curr.path = currVal.slice(0, -12);
      }
      break;
    }
    default: {
      var bin = "portal2_linux";
      if(NL_OS === "Darwin") bin = "portal2_osx";
      const pgrep = (await Neutralino.os.execCommand(`pgrep -af ${bin} | grep -Fsv $$`)).stdOut.split("\n")[0];
      if(pgrep.length === 0) break;
      curr.pid = Number(pgrep.split(" ")[0]);
      const pwdx = (await Neutralino.os.execCommand(`pwdx ${curr.pid}`)).stdOut;
      curr.path = pwdx.slice(pwdx.indexOf(": ") + 2, -1) + "/";
      break;
    }
  }

  return curr;

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

      for(let i = 0; i < entries.length; i++) {
        const currVal = entries[i].slice(entries[i].indexOf(" : ") + 3);
        if(entries[i].startsWith("Id")) curr.pid = Number(currVal);
        else if(entries[i].startsWith("Path")) {
          curr.cmd = `"${currVal}"`;
          curr.path = currVal.slice(0, -10);
        }
      }

      break;

    }
    default: {

      const pgrep = (await Neutralino.os.execCommand(`pgrep -af steam`)).stdOut.split("\n");

      let proc = null;
      for(let i = 0; i < pgrep.length; i++) {
        if(pgrep[i].endsWith("/steam") || pgrep[i].indexOf("/steam ") > -1) {
          proc = pgrep[i];
          break;
        }
      }
      if(!proc) break;

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
      for(let i = 0; i < env.length - 1; i ++) {
        let currVar = env[i].split(" ");
        let currVal = env[i+1].split(" ");
        currVar = currVar[currVar.length - 1];
        if(currVal.length == 1) {
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

var gameStartInterval, gameCloseInterval;

async function launchMod(packageID) {

  hideInfo();
  setActivePackage(-1);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  setStatusText("Looking for Portal 2...");

  // Get game PID and path
  game = await getGameProcessInfo();

  if(!game.pid) return setStatusText("Portal 2 is not running", true);
  if(!("path" in game) || game.path.length < 7) return setStatusText("Could not find game path!");

  setStatusText("Closing Portal 2...");

  // Kill existing game process
  if(NL_OS === "Windows") await Neutralino.os.execCommand(`powershell -command "Stop-Process -Id ${game.pid}"`);
  else await Neutralino.os.execCommand(`kill ${game.pid}`);

  setStatusText("Installing package...");

  await installMod(game.path, packageID);

  setStatusText("Looking for Steam...");

  // Get Steam PID, current path and command line
  steam = await getSteamProcessInfo();

  setStatusText("Starting Portal 2...");

  await Neutralino.os.execCommand(`${steam.cmd} -applaunch 620 ${packageID < 0 ? "" : "-tempcontent"} ${NL_OS !== "Windows" ? "&" : ""}`, { background: true });

  setActivePackage(packageID);

  // Check if game is running
  gameStartInterval = setInterval(async function() {

    if((await getGameProcessInfo()).pid) {

      setStatusText("Portal 2 started", true);
      clearInterval(gameStartInterval);

      // Handle game closing
      gameCloseInterval = setInterval(async function() {
        if(!(await getGameProcessInfo()).pid) {

          clearInterval(gameCloseInterval);

          setStatusText("Portal 2 closed", true);
          setActivePackage(-1);
          installMod(game.path, -1);

        }
      }, 3000);

    }
  }, 3000);

}

async function shutdownSpplice() {

  setStatusText("Shutting down Spplice...", true);

  clearInterval(gameStartInterval);
  clearInterval(gameCloseInterval);

  if("pid" in game && game.pid) {
    const currPID = (await getGameProcessInfo()).pid;
    if(NL_OS === "Windows") await Neutralino.os.execCommand(`powershell -command "Stop-Process -Id ${currPID}"`);
    else await Neutralino.os.execCommand(`kill ${currPID}`);
  }

  if("path" in game) await installMod(game.path, -1);

  Neutralino.app.exit();

}

Neutralino.events.on("windowClose", function () {
  shutdownSpplice();
});
