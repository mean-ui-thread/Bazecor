import type { ForgeConfig, ForgePackagerOptions } from "@electron-forge/shared-types";
import MakerFlatpak from "@electron-forge/maker-flatpak";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import { spawnSync } from "child_process";
import rendererConfig from "./webpack.renderer.config";
import mainConfig from "./webpack.main.config";

const packagerConfig: ForgePackagerOptions = {
  appBundleId: "com.dygmalab.bazecor",
  darwinDarkModeSupport: true,
  asar: false,
  icon: "./build/logo",
  name: "Bazecor",
  osxUniversal: {
    x64ArchFiles: "*",
  },
  extraResource: ["NEWS.md", "src/defaultBackups"],
  appCopyright: "Copyright © 2018, 2023 DygmaLab SL; distributed under the GPLv3",
};

if (process.env["NODE_ENV"] !== "development") {
  packagerConfig.osxSign = {
    optionsForFile: () => ({
      app: "com.dygmalab.bazecor",
      identity: process.env["APPLE_IDENTITY"],
      // entitlements: "./build/entitlements.plist",
      "gatekeeper-assess": false,
      hardenedRuntime: true,
    }),
  };
  packagerConfig.osxNotarize = {
    appleId: process.env["APPLE_ID"] || "",
    appleIdPassword: process.env["APPLE_ID_PASSWORD"] || "",
    teamId: process.env["APPLE_TEAM_ID"] || "",
  };
}

const config: ForgeConfig = {
  packagerConfig,
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "bazecor",
      setupIcon: "./build/logo.ico",
    }),
    new MakerZIP({}, ["darwin"]),
    {
      name: "@electron-forge/maker-dmg",
      config: {
        icon: "./build/logo.icns",
      },
    },
    {
      name: "@reforged/maker-appimage",
      config: {
        options: {
          bin: "Bazecor",
          categories: ["Utility"],
          icon: "./build/logo.png",
        },
      },
    },
    new MakerFlatpak(
      {
        options: {
          // Cannot be 'com.dygmalab.bazecor' because appstream would complain about https://dygmalab.com
          // being non-existant and the app would not be accepted in Flathub.
          id: "com.dygma.bazecor",
          bin: "Bazecor",
          productName: "Bazecor",
          genericName: "Keyboard Programmer",
          branch: "stable",

          // https://specifications.freedesktop.org/icon-theme-spec/latest/
          icon: "./build/logo.png",

          // https://specifications.freedesktop.org/menu-spec/latest/category-registry.html
          categories: [
            // Main Category
            "Utility",
          ],

          // Available versions: https://freedesktop-sdk.gitlab.io/documentation/updating-sdk/release-notes/
          runtime: "org.freedesktop.Platform",
          runtimeVersion: "25.08",
          // Available versions: https://github.com/flathub/org.electronjs.Electron2.BaseApp/
          base: "org.electronjs.Electron2.BaseApp",
          baseFlatpakref: "https://flathub.org/repo/appstream/org.electronjs.Electron2.BaseApp.flatpakref",
          baseVersion: "25.08",
          sdk: "org.freedesktop.Sdk",

          // Based on https://github.com/malept/electron-installer-flatpak/blob/main/src/installer.js
          // Available versions: https://github.com/refi64/zypak/releases
          modules: [
            {
              name: "zypak",
              sources: [
                {
                  type: "git",
                  url: "https://github.com/refi64/zypak",
                  tag: "v2025.09",
                  commit: "693a71c5ffa80ec9c9ce2ae03b1ccc493c698e53"
                },
              ],
            },
            // build and install /app/bin/udevadm and /app/lib/libudev.so
            // Available versions: https://github.com/eudev-project/eudev/releases
            {
              name: "eudev",
              sources: [
                {
                  type: "git",
                  url: "https://github.com/eudev-project/eudev",
                  tag: "v3.2.14",
                  commit: "9e7c4e744b9e7813af9acee64b5e8549ea1fbaa3"
                },
              ],
              cleanup: [
                "/include",
                "/etc",
                "/libexec",
                "/sbin",
                "/lib/pkgconfig",
                "/man",
                "/share/aclocal",
                "/share/doc",
                "/share/gtk-doc",
                "/share/man",
                "/share/pkgconfig",
                "*.la",
                "*.a",
              ],
            },
          ],

          files: [
            ["build/com.dygma.bazecor.desktop", "/share/applications/com.dygma.bazecor.desktop"],
            ["build/com.dygma.bazecor.metainfo.xml", "/share/metainfo/com.dygma.bazecor.metainfo.xml"],
            ["build/logo.png", "/share/icons/hicolor/512x512/apps/com.dygma.bazecor.png"],
          ],

          finishArgs: [
            // Display servers
            // https://docs.flatpak.org/en/latest/electron.html#enable-native-wayland-support-by-default
            "--socket=wayland",
            "--socket=fallback-x11",
            "--share=ipc",

            // This is to allow device access for your Dygma Raise or Defy keyboard. We require access to HID Raw
            // (hidraw) and Serial (ttyACM) and couldn't find any other way to grant these permissions here
            // https://docs.flatpak.org/en/latest/sandbox-permissions.html#device-access which is why we are using "all".
            // This is probably a security risk, but it is the only way to get Bazecor to work.
            "--device=all",

            // Add this to allow reading USB device metadata
            "--filesystem=/run/udev:ro",

            // The default still appears to be 'x11'. Switch to 'auto' to allow Wayland to be used when available.
            "--env=ELECTRON_OZONE_PLATFORM_HINT=auto",

            // Read/write access to the user's Documents directory (purpose: for backups)
            "--filesystem=xdg-documents",

            // For legacy users when the ~/Dygma folder already exists for their backups. Because flatpak does
            // not have a write access to the user's home directory, it won't be able to create this folder
            // on its own, which is precisely why we have changed the backup folder to use ~/Documents/Dygma
            // instead.
            "--filesystem=~/Dygma",

            // For allowing read access to /etc to detect if the udev rules files files are already installed.
            // Please note that flatpak *CANNOT* call DEBUG=* electron-forge make'sudo' in any shape or form. If the udev file is missing
            // the only thing we can do is to ask the user to install it manually. This is a limitation of
            // flatpak and we cannot escalate privileges.
            "--filesystem=host-etc",

            // For discovering and downloading the latest firmware
            "--share=network",

            // For preventing Chromium/Electron shared memory crashes on some Wayland compositors
            "--allow=per-app-dev-shm",

            // To ensure proper mouse cursor scaling on HiDPI displays under Wayland, the XCURSOR_PATH environment
            // variable must be set to the host’s corresponding directories
            // https://docs.flatpak.org/en/latest/electron.html#enable-native-wayland-support-by-default
            "--env=XCURSOR_PATH=/run/host/user-share/icons:/run/host/share/icons",
          ],
        },
      },
      ["linux"],
    ),
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: "connect-src 'self' *.github.com github.com objects.githubusercontent.com 'unsafe-eval';",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/renderer/index.html",
            js: "./src/renderer/index.tsx",
            name: "main_window",
            preload: {
              js: "./src/preload/preload.ts",
            },
          },
        ],
      },
    }),
  ],
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath, _electronVersion, platform, _arch) => {
      /**
       * Serialport, usb and uiohook-napi are problematic libraries to run in Electron.
       * When Electron app is been built, these libraries are not included properly in the final executable.
       * What we do here is to install them explicitly and then remove the files that are not for the platform
       * we are building for
       */
      const packageJson = JSON.parse(fs.readFileSync(path.resolve(buildPath, "package.json")).toString());

      packageJson.dependencies = {
        serialport: "^12.0.0",
        usb: "^2.9.0",
        "uiohook-napi": "^1.5.4",
      };

      fs.writeFileSync(path.resolve(buildPath, "package.json"), JSON.stringify(packageJson));
      spawnSync("npm", ["install", "--omit=dev"], {
        cwd: buildPath,
        stdio: "inherit",
        shell: true,
      });

      const prebuilds = globSync(`${buildPath}/**/prebuilds/*`);
      prebuilds.forEach(function (path) {
        if (!path.includes(platform)) {
          fs.rmSync(path, { recursive: true });
        }
      });
    },
  },
  publishers: [],
};

export default config;
