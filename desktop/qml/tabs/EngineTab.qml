import QtQuick
import QtQuick.Layouts
import "../controls"
import "../panels"
import "../controls/Theme.js" as Theme

// Onglet Moteur : cycle de vie, horloge audio (lue sur TimoxVasio, non réglable ici), indicateurs
// d'exécution, arbre des nœuds et bancs de mesure.
Item {
    id: tab
    property var client: null
    property var store: null
    property string errorText: ""

    readonly property var engine: store ? store.engine : ({})
    readonly property string status: engine.status || ""
    readonly property var runtime: store ? store.runtime : ({})
    readonly property bool canStart: status === "stopped" || status === "failed"
    readonly property bool canStopOrRestart: status === "running"
    property alias startButton: startButton
    property alias stopButton: stopButton
    property alias restartButton: restartButton
    property alias clockText: clock.text

    function lifecycle(action) { errorText = ""; client.post("/api/engine/" + action); }
    function runtimeLine(label, value, unit) { return value === undefined || value === null ? "" : label + " : " + value + (unit ? " " + unit : ""); }

    Connections {
        target: tab.client
        ignoreUnknownSignals: true
        function onRequestFailed(method, path, code, message) {
            if (path.indexOf("/api/engine") === 0)
                tab.errorText = message;
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 12

        ColumnLayout {
            Layout.preferredWidth: 520
            Layout.fillHeight: true
            spacing: 8

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: lifeColumn.implicitHeight + 20
                color: Theme.panel; radius: 6; border.color: Theme.line
                ColumnLayout {
                    id: lifeColumn
                    x: 10; y: 10
                    width: parent.width - 20
                    spacing: 6
                    Text { text: "MOTEUR"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
                    Text {
                        text: "État : " + tab.status + (tab.engine.scsynthPid ? " — scsynth PID " + tab.engine.scsynthPid : "")
                        color: tab.status === "running" ? Theme.ok : (tab.status === "failed" ? Theme.mute : Theme.text)
                        font.pixelSize: Theme.fontNormal
                    }
                    Text {
                        visible: !!tab.engine.error
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: "Dernière erreur : " + (tab.engine.error || "")
                        color: Theme.mute
                        font.pixelSize: Theme.fontSmall
                    }
                    ErrorBanner { Layout.fillWidth: true; text: tab.errorText; onTextChanged: tab.errorText = text }
                    RowLayout {
                        Toggle { id: startButton; objectName: "button-start"; label: "Démarrer"; enabled: tab.canStart; onToggled: tab.lifecycle("start") }
                        Toggle { id: stopButton; objectName: "button-stop"; label: "Arrêter"; enabled: tab.canStopOrRestart; onToggled: tab.lifecycle("stop") }
                        Toggle { id: restartButton; objectName: "button-restart"; label: "Redémarrer"; enabled: tab.canStopOrRestart; onToggled: tab.lifecycle("restart") }
                    }
                    Text {
                        id: clock
                        objectName: "text-clock"
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: tab.engine.audioClock
                              ? "Horloge audio : " + tab.engine.audioClock.sampleRate + " Hz, bloc de " + tab.engine.audioClock.bufferFrames
                                + " trames (réglées dans TimoxVasio)"
                              : "Horloge audio : moteur arrêté (fréquence et bloc réglés dans TimoxVasio)"
                        color: Theme.text
                        font.pixelSize: Theme.fontSmall
                    }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: runtimeColumn.implicitHeight + 20
                color: Theme.panel; radius: 6; border.color: Theme.line
                Column {
                    id: runtimeColumn
                    x: 10; y: 10
                    spacing: 3
                    Text { text: "EXÉCUTION"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
                    Repeater {
                        model: [["CPU moyen", "cpuAvg", "%"], ["CPU crête", "cpuPeak", "%"], ["Synths", "synths", ""], ["UGens", "ugens", ""],
                                ["Groupes", "groups", ""], ["Fréquence demandée", "sampleRateRequested", "Hz"],
                                ["Fréquence effective", "sampleRateActual", "Hz"], ["Taille de bloc", "blockSize", "échantillons"],
                                ["Buffer matériel", "hardwareBufferFrames", "trames"], ["Latence", "latencyMs", "ms"], ["Dernier /fail", "lastFail", ""]]
                        delegate: Text {
                            required property var modelData
                            visible: text !== ""
                            text: tab.runtimeLine(modelData[0], tab.runtime ? tab.runtime[modelData[1]] : undefined, modelData[2])
                            color: Theme.text
                            font.pixelSize: Theme.fontSmall
                        }
                    }
                    Text { visible: !tab.runtime || tab.runtime.cpuAvg === undefined; text: "Aucune mesure (moteur arrêté)"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
                }
            }

            BenchPanel {
                Layout.fillWidth: true
                client: tab.client
                parameters: tab.store ? tab.store.parameters : ({})
                enabled: tab.status === "running"
            }
            Item { Layout.fillHeight: true }
        }

        NodeTree {
            Layout.fillWidth: true
            Layout.fillHeight: true
            client: tab.client
            enabled: tab.status === "running"
        }
    }
}
