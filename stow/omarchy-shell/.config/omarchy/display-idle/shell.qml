import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

// Independent of Omarchy's Stay Awake toggle: blank displays, never suspend
// or lock. Keep application inhibitors (e.g. video playback) effective.
ShellRoot {
  IdleMonitor {
    timeout: 600
    respectInhibitors: true
    onIsIdleChanged: {
      console.log("Display idle: DPMS " + (isIdle ? "off" : "on"))
      dpmsProcess.command = [
        "hyprctl", "dispatch",
        'hl.dsp.dpms({action="' + (isIdle ? "off" : "on") + '"})'
      ]
      dpmsProcess.running = true
    }
  }

  // Capture failures instead of silently discarding the dispatch result.
  Process {
    id: dpmsProcess
    stdout: StdioCollector {
      onStreamFinished: console.log("DPMS result: " + text.trim())
    }
    stderr: StdioCollector {
      onStreamFinished: {
        if (text.trim()) console.warn("DPMS stderr: " + text.trim())
      }
    }
    onExited: (exitCode, exitStatus) => {
      if (exitCode !== 0 || exitStatus !== 0)
        console.warn("DPMS command failed: exit=" + exitCode + " status=" + exitStatus)
    }
  }
}
