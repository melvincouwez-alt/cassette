import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, Notification } from "electron";
import log from "electron-log/main";

import { DESKTOP_ID } from "./identity";
import { errorMessage } from "./utils";

const notifyLog = log.scope("notify");

// The only place in Sidra a Notification is constructed, because on Linux
// Notification.show() blocks the browser UI thread when nothing owns
// org.freedesktop.Notifications. Electron calls notify_notification_show()
// inline, libnotify builds its GDBusProxy without DO_NOT_AUTO_START, so GLib
// runs StartServiceByName in a nested main loop and waits the 25 second D-Bus
// activation timeout; Electron queries server capabilities three times before
// the show, so one notification freezes the window for about 100 seconds.
// createNotification() returns null while the gate is closed, and constructing
// a Notification anywhere else reopens the freeze.

// The gate starts closed on Linux and opens on the first probe reply: a
// notification raised before the reply lands has no verified answer, and
// guessing wrong costs a 100 second freeze. Tests on other platforms have no
// daemon to probe, so the gate is open from the start there.
let daemonAvailable = process.platform !== "linux";
let failureLatched = false;

/** True when a notification can be raised without risking the Linux D-Bus freeze. */
export function notificationsAvailable(): boolean {
  return daemonAvailable && !failureLatched;
}

/**
 * On Linux, follow notification-daemon ownership for the session.
 * Call once from app.whenReady(). Other platforms need no probe.
 */
export function initNotificationProbe(): void {
  if (process.platform !== "linux") {
    return;
  }

  try {
    // linuxNotifications imports @holusion/dbus-next, so load it only after the
    // platform check to keep D-Bus out of the import graph elsewhere.
    const { createLinuxNotifications } =
      require("./linuxNotifications") as typeof import("./linuxNotifications");

    createLinuxNotifications((hasOwner: boolean) => {
      const wasAvailable = notificationsAvailable();
      daemonAvailable = hasOwner;
      if (hasOwner) {
        // A daemon appearing mid-session must clear a latch left by an earlier
        // failure, or notifications stay dead until a restart
        failureLatched = false;
      }
      if (notificationsAvailable() !== wasAvailable) {
        notifyLog.info(
          hasOwner
            ? "notifications enabled"
            : "notifications disabled: no notification daemon",
        );
      }
    });
  } catch (err: unknown) {
    notifyLog.warn(
      "notification daemon probe unavailable; notifications disabled:",
      errorMessage(err),
    );
  }
}

/**
 * Mute Cassette's notification sound on elementary OS, once per profile.
 * Electron ignores `silent` on Linux and io.elementary.notifications plays its
 * category sound unless the per-app "sounds" key is off. The marker file keeps
 * a later choice in System Settings > Notifications from being overwritten.
 */
export function muteElementaryNotificationSound(): void {
  if (process.platform !== "linux") return;
  const marker = join(app.getPath("userData"), "notification-sound-muted");
  if (existsSync(marker)) return;
  const path = `/io/elementary/notifications/applications/${DESKTOP_ID}/`;
  execFile(
    "gsettings",
    [
      "set",
      `io.elementary.notifications.applications:${path}`,
      "sounds",
      "false",
    ],
    (err) => {
      if (err) {
        notifyLog.debug(
          "elementary notification sound left as is:",
          err.message,
        );
        return;
      }
      try {
        writeFileSync(marker, "");
      } catch (writeErr: unknown) {
        notifyLog.warn(
          "notification sound marker not written:",
          errorMessage(writeErr),
        );
      }
      notifyLog.info("elementary notification sound muted");
    },
  );
}

/**
 * Build a Notification, or return null when nothing can receive it. Callers
 * must handle the null rather than assume a notification exists.
 */
export function createNotification(
  options: Electron.NotificationConstructorOptions,
): Notification | null {
  if (!notificationsAvailable()) {
    notifyLog.debug(
      "notification suppressed; no notification daemon:",
      options.title,
    );
    return null;
  }

  const notification = new Notification(options);

  notification.on("failed", (_event, error) => {
    notifyLog.error("notification failed:", options.title, error);
    // Linux only: NameOwnerChanged re-opens the gate when a daemon appears.
    // Nothing else has that recovery path, so a latch elsewhere would disable
    // notifications for the rest of the session.
    if (process.platform === "linux") {
      failureLatched = true;
    }
  });

  return notification;
}
