Neutralino.init();

// OS-dependant path separators
const S = (NL_OS === "Windows" ? '\\' : '/');
// OS-dependant Tar command line
const TAR = (NL_OS === "Windows" ? "start /B /WAIT C:\\Windows\\System32\\tar.exe" : "tar --force-local");
// Package repository address
const REPO = "95.217.182.22";
// spplice settings
var ARGS = {
  online: true,
  queuedMod: null
}

async function autoUpdate() {

  try {
    let url = `http://${REPO}/spplice/app/manifest.json?r=` + Math.floor(Math.random() * 1000);
    let manifest = await Neutralino.updater.checkForUpdates(url);

    if (manifest.version != NL_APPVERSION) {
      await Neutralino.updater.install();
      setStatusText("Update installed, please restart Spplice");
      // await Neutralino.app.restartProcess();
    }
  } catch(e) {
    console.log("Error while checking for updates: " + e);
  }

}

autoUpdate();

function arrayBufferToBase64(buffer) {

  var binary = "";
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;

  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return window.btoa(binary);

}

async function forceRemoveDirectory(path) {

  if (path[path.length - 1] !== S) path += S;
  const dir = await Neutralino.filesystem.readDirectory(path);

  for (let i = 0; i < dir.length; i++) {
    if (dir[i].type === "FILE") await Neutralino.filesystem.removeFile(path + dir[i].entry);
    else if (dir[i].entry !== "." && dir[i].entry !== "..") {
      await forceRemoveDirectory(`${path}${S}${dir[i].entry}`);
    }
  }

  await Neutralino.filesystem.removeDirectory(path);

}

async function updateResolution() {

  if (NL_OS === "Windows") return;

  const display = (await Neutralino.computer.getDisplays())[0];
  const config = await Neutralino.app.getConfig();

  // Recalculate resolution including screen size and dpi
  const ogWidth = config.modes.window.width;
  const ogHeightMultip = ogWidth / config.modes.window.height;

  const width = (display.dpi / 96) * // 96 dpi reference 
              (display.resolution.width / 1920) *  // 1920 width reference
              ogWidth;
  const height = width / ogHeightMultip; // 8:5 ratio

  Neutralino.window.setSize({width: width, height: height});

}

var index, activePackage = -1;
async function loadCards() {

  await updateResolution();

  const r = Math.floor(Math.random() * 1000); // Prevent caching
  if (ARGS.online) {
    let response = await fetch(`http://${REPO}/spplice/packages/index.php?r=` + r);

    if (response.ok) {
      index = await response.json();
    } else {
      document.getElementById("cardlist").innerHTML = `
        <h1 class="center-text">Failed to connect to Spplice server</h1>
        <p class="center-text"><i>Response status: ${response.status}</i></p>
      `;
    }
  } else {
    index = {}
    index.packages = [];
  }

  // Check for local packages
  try { await Neutralino.filesystem.readDirectory(`${NL_PATH}/custom`) }
  catch (e) { await Neutralino.filesystem.createDirectory(`${NL_PATH}/custom`) }
  var customDir = await Neutralino.filesystem.readDirectory(`${NL_PATH}/custom`);

  // Unarchive packages
  for (let i = 0; i < customDir.length; i++) {
    const curr = customDir[i];
    if (curr.entry === "." || curr.entry === "..") continue;
    if (curr.type === "FILE" && curr.entry.endsWith(".tar.gz")) {
      await Neutralino.os.execCommand(`${TAR} -xzf "${NL_PATH}${S}custom${S}${curr.entry}" -C "${NL_PATH}${S}custom${S}"`);
      await Neutralino.filesystem.removeFile(`${NL_PATH}/custom/${curr.entry}`);
    }
  }

  // Add to package index
  customDir = await Neutralino.filesystem.readDirectory(`${NL_PATH}/custom`);
  for (let i = 0; i < customDir.length; i++) {

    const curr = customDir[i];

    if (curr.entry === "." || curr.entry === "..") continue;
    if (curr.type === "DIRECTORY") {
      const manifest = JSON.parse(await Neutralino.filesystem.readFile(`${NL_PATH}/custom/${curr.entry}/manifest.json`));
      manifest.local = true;
      index.packages[index.packages.length] = manifest;
    }

  }

  for (let i = 0; i < index.packages.length; i++) {

    const curr = index.packages[i];
    let name = curr.name;
    let title = curr.title;

    var image;
    if (("local" in curr) && curr.local) {
      const base64 = arrayBufferToBase64(await Neutralino.filesystem.readBinaryFile(`${NL_PATH}/custom/${curr.name}/${curr.icon}`));
      image = `data:image/png;base64,${base64}`;
    } else {
      image = `http://${REPO}/spplice/packages/${name}/${curr.icon}?r=${r}`;
    }

    document.getElementById("cardlist-insert").innerHTML += `
      <div class="card" style="background-image: url('${image}')" onclick="showInfo(${i})">
        <p class="card-title">${title}</p>
      </div>
    `;

  }
  // start specified mod
  launchModFromName(ARGS.queuedMod);
}

function showInfo(packageID) {

  const div = document.getElementById("modinfo");
  const title = document.getElementById("modinfo-title");
  const description = document.getElementById("modinfo-description");
  const button = document.getElementById("modinfo-button");

  title.innerHTML = index.packages[packageID].title;
  description.innerHTML = index.packages[packageID].description.replace(/\n/g, "<br>");
  button.onclick = function() {  };

  if (packageID === activePackage) {

    button.innerHTML = "Installed";
    button.style.pointerEvents = "none";
    button.style.color = "#424242";

  } else {

    if ("local" in index.packages[packageID] && index.packages[packageID].local) {

      button.innerHTML = `
        <span id="modinfo-delete" onclick="removePackage(${packageID})">Remove</span><br>
        <span onclick="launchMod(${packageID})">Install and launch<span>
      `;

    } else {

      button.innerHTML = `
        <span onclick="launchMod(${packageID})">Install and launch</span>
      `;

    }

    button.style.pointerEvents = "auto";
    button.style.color = "#faa81a";

  }

  div.style.opacity = 1;
  div.style.transform = "translateY(0)";
  div.style.setProperty("backdrop-filter", "blur(5px)");
  div.style.setProperty("-webkit-backdrop-filter", "blur(5px)");
  div.style.pointerEvents = "auto";

}

function hideInfo() {

  const div = document.getElementById("modinfo");
  const button = document.getElementById("modinfo-button");

  button.onclick = function() { };
  button.style.pointerEvents = "none";

  div.style.opacity = 0;
  div.style.transform = "translateY(5vh)";
  div.style.setProperty("backdrop-filter", "blur(0px)");
  div.style.setProperty("-webkit-backdrop-filter", "blur(0px)");
  div.style.pointerEvents = "none";

}

function setActivePackage(packageID) {

  if (activePackage >= 0) {

    const title = document.getElementsByClassName("card-title")[activePackage];
    title.style.color = "#fff";

  }

  if (packageID >= 0) {

    const title = document.getElementsByClassName("card-title")[packageID];
    title.style.color = "#faa81a";

    const clear = document.getElementById("spplice-clear");
    clear.style.pointerEvents = "auto";
    clear.style.opacity = 1;

  } else {

    const clear = document.getElementById("spplice-clear");
    clear.style.pointerEvents = "none";
    clear.style.opacity = 0;

  }

  activePackage = packageID;

}

function updateSearch() {

  const query = document.getElementById("search-input").value.replace(/ /g, "").toLowerCase();

  for (let i = 0; i < index.packages.length; i++) {

    const title = index.packages[i].title.replace(/ /g, "").toLowerCase();
    const name = index.packages[i].name.replace(/ /g, "").toLowerCase();

    if (title.indexOf(query) != -1 || name.indexOf(query) != -1) {
      document.getElementsByClassName("card")[i].style.display = "inline-block";
    } else {
      document.getElementsByClassName("card")[i].style.display = "none";
    }

  }

}

async function importCustom() {

  const filter = {
    filters: [{
      name: "Tar archive",
      extensions: ["tar.gz"]
    }]
  };

  const file = (await Neutralino.os.showOpenDialog("Select custom package", filter))[0];
  if (!file) return;

  try { await Neutralino.filesystem.readDirectory(`${NL_PATH}/custom/.tmp`) }
  catch (e) { await Neutralino.filesystem.createDirectory(`${NL_PATH}/custom/.tmp`) }

  await Neutralino.os.execCommand(`${TAR} -xzf "${file}" -C "${NL_PATH}${S}custom${S}.tmp"`);

  try {

    const tmpdir = await Neutralino.filesystem.readDirectory(`${NL_PATH}/custom/.tmp`);
    for (let i = 0; i < tmpdir.length; i++) {
      if (tmpdir[i].entry !== "." && tmpdir[i].entry !== "..") {

        const manifest = JSON.parse(await Neutralino.filesystem.readFile(`${NL_PATH}/custom/.tmp/${tmpdir[i].entry}/manifest.json`));
        manifest.local = true;

        var id = -1;
        for (let j = 0; j < index.packages.length; j++) {
          if (index.packages[j].name === manifest.name) {
            id = j;
            break;
          }
        }

        if (id === -1) id = index.packages.length;
        index.packages[id] = manifest;

        break;

      }
    }

    await Neutralino.filesystem.moveFile(`${NL_PATH}/custom/.tmp/${index.packages[id].name}`, `${NL_PATH}/custom/${index.packages[id].name}`);
    await forceRemoveDirectory(`${NL_PATH}/custom/.tmp`);

  } catch (e) {

    Neutralino.os.showMessageBox(
      "Invalid package",
      "An error occured while installing the package. Are you sure this is the right file?",
      "OK",
      "ERROR"
    );
    console.log(e);
    await forceRemoveDirectory(`${NL_PATH}/custom/.tmp`);
    return;

  }

  const title = index.packages[id].title;
  const name = index.packages[id].name;
  const icon = index.packages[id].icon;

  const base64 = arrayBufferToBase64(await Neutralino.filesystem.readBinaryFile(`${NL_PATH}/custom/${name}/${icon}`));
  const image = `data:image/png;base64,${base64}`;

  document.getElementById("cardlist-insert").innerHTML += `
    <div class="card" style="background-image: url('${image}')" onclick="showInfo(${id})">
      <p class="card-title">${title}</p>
    </div>
  `;

}

async function removePackage(packageID) {

  const choice = await Neutralino.os.showMessageBox(
    "Confirm deletion",
    "Are you sure you want to delete this mod?",
    "YES_NO",
    "WARNING"
  );

  if (choice === "YES") {

    hideInfo();
    await forceRemoveDirectory(`${NL_PATH}/custom/${index.packages[packageID].name}`);
    document.getElementsByClassName("card")[packageID].remove();

  }

}

var statusTextTimeout = null;
function setStatusText(text, hide) {

  if (typeof hide === "undefined") hide = false;

  console.log(text);
  let element = document.getElementById("pplaunch-status");
  element.style.pointerEvents = "all";
  element.style.opacity = 1;
  element.innerHTML = text;

  if (hide) {

    clearTimeout(statusTextTimeout);
    statusTextTimeout = setTimeout(function() {
      element.style.pointerEvents = "none";
      element.style.opacity = 0;
    }, 5000);

  }

}

function parseCommandLineArgs() {
  const argActions = {};
  let i;

  // register command line args to scan for
  argActions['-offline'] = function() {
    ARGS.online = false;
  }
  argActions['-start'] = function() {
    try {
      const modName = NL_ARGS[i + 1];
      ARGS.queuedMod = modName;
      i++;
    } catch (e) {
      console.warn(`Failed to start a mod by name.`);
      console.warn(e);
    }
  }

  for (i = 1; i < NL_ARGS.length; i++) {
    const arg = NL_ARGS[i];
    try {
      if (arg.indexOf('--')<0 && // double dash is used by neutralinojs
      arg.length > 0) { 
        argActions[arg]();
      }
    } catch (e) {
      console.warn(`Argument "${arg}" doesn't exist.`)
    }
  }
}
parseCommandLineArgs();
