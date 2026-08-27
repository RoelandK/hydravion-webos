# Hydravion - install guide

So you want to get Hydravion on your LG TV. Good choice. This guide covers everything from setting up developer mode on the TV, to installing the tools on your PC and getting the app deployed.

There are two ways to run the app:

1. On a real LG webOS TV
2. On the webOS Simulator on your PC (no TV needed)

Both need the same PC tools, so lets start there.

---

## What you need on your PC

### Node.js

The ares tools are npm packages, so you need Node.js first.

1. Go to https://nodejs.org and download the LTS version
2. Install it, just keep clicking next. Make sure "Add to PATH" is checked, its usually on by default
3. Open a command prompt and check it works:

```
node -v
npm -v
```

You should see a version number for both.

### The ares CLI tools

The ares tools are made by LG and let you talk to your TV. Install them globally with npm:

```
npm install -g @webos-tools/cli
```

This gives you commands like `ares-package`, `ares-install`, `ares-launch` and `ares-setup-device`. You will use these all the time.

### The project

Clone the repo somewhere on your PC:

```
git clone <your-repo-url> hydravion-webos
cd hydravion-webos
```

There is no build step needed before deploying, the app is just html and js. But there is a build script that packages the IPK for you, more on that below.

---

## Option 1: webOS Simulator (no TV)

The simulator is a virtual TV that runs on your PC. Great for testing without touching your real TV.

1. Download the webOS TV Simulator from the LG webOS developer site (you need to sign up for a free LG developer account)
2. Install and launch it. You get a window that looks like a TV
3. The simulator listens on port 9998 with user `root`, no password

The simulator should already be registered as a device called `emulator`. Check with:

```
ares-setup-device --list
```

If its not there, add it:

```
ares-setup-device -a emulator
# Hostname: 127.0.0.1
# Port: 9998
# Username: root
# Password: (leave empty)
```

Now skip down to the deploy section, it works the same.

---

## Option 2: Real LG TV

### Step 1: Turn on Developer Mode on the TV

1. Open the LG Content Store on your TV
2. Search for **Developer Mode**
3. Install it and open it
4. You need a LG developer account. Create one at https://webostv.developer.lge.com if you dont have one
5. In the Developer Mode app, sign in with that account
6. Set a password. Remember this, you need it later
7. Enable Developer Mode. You will see a little key icon in the corner of the screen when its on

### Step 2: Find the TVs IP address

1. On the TV go to Settings > Network > Wi-Fi Information (or wired, depends how you connect)
2. Note the IP address, something like 192.168.1.50

### Step 3: Register the TV in ares

Back on your PC:

```
ares-setup-device -a tv
```

It asks for:

- **Hostname or IP**: the TV's IP address you just wrote down
- **Port**: 9922 (this is the default for the developer mode ssh)
- **Username**: whatever you want, it does not matter much, something like `developer`
- **Password**: the password you set in the Developer Mode app

You can also use the interactive editor:

```
ares-setup-device -e tv
```

Fill in the same fields and save.

Check it shows up:

```
ares-setup-device --list
```

### Step 4: Open the developer mode session

Each time you want to deploy you might need to wake up the developer session:

```
ares-novacom -d tv --devicekey --open
```

Or just make sure the Developer Mode app is running on the TV and the key icon is visible.

---

## Building the app

The repo has a build script that packages everything into an IPK (the install file format for webOS).

### Windows

```
.\build.ps1
```

### Linux / macOS

```
./build.sh
```

The script:

1. Checks the code for a known webOS gotcha (`Object.hasOwn`, which crashes old Chrome on webOS)
2. Runs a smoke test that loads all the scripts and checks the wiring
3. Packages the app into an IPK

The output is named something like `com.hydravion.tv_2.2.0_all.ipk` in the project folder.

If you want to build manually without the script:

```
ares-package . services/com.hydravion.tv.service -o .
```

---

## Deploying to the TV / simulator

### Step 1: Install

Point ares at your device (`tv` for the real TV, `emulator` for the simulator) and install the IPK:

```
ares-install -d tv ./com.hydravion.tv_2.2.0_all.ipk
```

or for the simulator:

```
ares-install -d emulator ./com.hydravion.tv_2.2.0_all.ipk
```

### Step 2: Launch

```
ares-launch -d tv com.hydravion.tv
```

The app should appear on the TV. If you already have an older version installed, installing the new IPK over it usually updates it in place.

### Updating

Sometimes its cleaner to remove first:

```
ares-install -d tv --remove com.hydravion.tv
ares-install -d tv ./com.hydravion.tv_2.2.0_all.ipk
ares-launch -d tv com.hydravion.tv
```

Note: removing the app wipes its local data, including your Watch Later list.

---

## Logging in

The first time you open the app you get the login screen. It shows a QR code.

1. On your phone, scan the QR code with the camera app
2. It opens floatplane.com with a code
3. Confirm the login on the website
4. The TV signs in automatically

If scanning is fiddly, the code is also shown as text on the screen, you can type it in on the website instead.

---

## Debugging

### Live logs from the TV

```
ares-log -d tv com.hydravion.tv
```

Streams the console output to your terminal. Very useful when something breaks.

### Web inspector

```
ares-inspect -d tv com.hydravion.tv
```

This gives you a Chrome DevTools URL. Open it in Chrome and you get the full inspector, console, DOM, network, the lot.

For the service (the background process that talks to Floatplane):

```
ares-inspect -s com.hydravion.tv.service -d tv
```

---

## Troubleshooting

**ares-install times out.** The TV is probably asleep or developer mode turned itself off. Wake the TV, reopen the Developer Mode app, run `ares-novacom -d tv --devicekey --open` again, and retry.

**Video plays on the simulator but not the TV, or the other way around.** The simulator and the real TV have slightly different codec and CDN behavior. If one works, the other usually does too after a retry.

**The app shows a login screen every time.** On some setups the session token does not persist. Logging in again fixes it.

**`ares` command not found.** npm global install did not add it to your PATH. On Windows, restart the terminal. If it still fails, check the npm global bin folder is on your PATH.

---

Thats it. Happy watching.
