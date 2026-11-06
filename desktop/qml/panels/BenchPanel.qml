import QtQuick
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme
import "../controls/Contract.js" as Contract

// Bancs de mesure : compresseur trois bandes (3 s sur signal interne) et banc EQ (bruit rose à la place de
// Master). L'état du banc EQ est relu dans l'API ; ses réglages viennent du catalogue (bench.eq).
Rectangle {
    id: bench
    property var client: null
    property var parameters: ({})
    property var compressorResult: null
    property var eqState: ({ running: false, method: null, parameters: null })
    property string errorText: ""
    property bool compressorRunning: false

    readonly property var eqStage: Contract.stage(parameters, "bench", "eq")
    function eqField(key) { return Contract.field(parameters, "bench", "eq", key) || ({}); }
    // Corps de requête du banc EQ à partir de l'état confirmé (ou des défauts du catalogue à l'arrêt).
    function eqBody(key, value) {
        var running = eqState.running;
        var body = { method: running ? eqState.method : eqField("method")["default"], parameters: {} };
        ["low", "mid", "high"].forEach(function (b) {
            body.parameters[b] = running ? eqState.parameters[b] : eqField(b)["default"];
        });
        if (key === "method")
            body.method = value;
        else if (key)
            body.parameters[key] = value;
        return body;
    }
    function refreshEq() { if (client) client.get("/api/benches/eq"); }
    function runCompressor() { errorText = ""; compressorRunning = true; client.post("/api/benches/compressor/run"); }
    function startEq() { errorText = ""; client.post("/api/benches/eq/start", eqBody()); }
    function stopEq() { errorText = ""; client.post("/api/benches/eq/stop"); }
    function setEq(key, value) { if (eqState.running) client.put("/api/benches/eq", eqBody(key, value)); }

    Component.onCompleted: refreshEq()
    color: Theme.panel
    radius: 6
    border.color: Theme.line
    implicitHeight: layout.implicitHeight + 20

    Connections {
        target: bench.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (path === "/api/benches/compressor/run") {
                bench.compressorResult = body;
                bench.compressorRunning = false;
            } else if (path.indexOf("/api/benches/eq") === 0) {
                bench.eqState = body;
            }
        }
        function onRequestFailed(method, path, code, message) {
            if (path.indexOf("/api/benches") === 0) {
                bench.errorText = message;
                bench.compressorRunning = false;
            }
        }
    }

    ColumnLayout {
        id: layout
        x: 10; y: 10
        width: parent.width - 20
        spacing: 8
        Text { text: "BANCS DE MESURE"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
        ErrorBanner { Layout.fillWidth: true; text: bench.errorText; onTextChanged: bench.errorText = text }

        RowLayout {
            Toggle {
                objectName: "button-compressor-bench"
                label: bench.compressorRunning ? "Mesure en cours (3 s)…" : "Banc compresseur"
                enabled: !bench.compressorRunning
                onToggled: bench.runCompressor()
            }
            Text { text: "Signal interne, jamais envoyé vers Master ni Cue."; color: Theme.dim; font.pixelSize: Theme.fontSmall }
        }
        Repeater {
            model: bench.compressorResult ? bench.compressorResult.cases : []
            delegate: Text {
                required property var modelData
                text: "Cas « " + modelData.case + " » : crête " + (modelData.peakDb === null ? "—" : modelData.peakDb.toFixed(1) + " dBFS")
                      + ", RMS " + (modelData.rmsDb === null ? "—" : modelData.rmsDb.toFixed(1) + " dBFS")
                color: Theme.text
                font.pixelSize: Theme.fontSmall
            }
        }
        Text {
            visible: bench.compressorResult !== null
            text: bench.compressorResult ? "Résultat : " + bench.compressorResult.status : ""
            color: Theme.dim
            font.pixelSize: Theme.fontSmall
        }

        RowLayout {
            Toggle {
                objectName: "button-eq-bench"
                label: bench.eqState.running ? "Arrêter le banc EQ" : "Démarrer le banc EQ"
                checked: bench.eqState.running
                onToggled: bench.eqState.running ? bench.stopEq() : bench.startEq()
            }
            Text { text: "Le banc EQ remplace Master par un bruit rose traité."; color: Theme.warn; font.pixelSize: Theme.fontSmall }
        }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            enabled: bench.eqState.running
            Repeater {
                model: bench.eqStage.fields
                delegate: ParameterControl {
                    required property var modelData
                    descriptor: modelData
                    confirmedValue: bench.eqState.running
                                    ? (modelData.key === "method" ? bench.eqState.method : bench.eqState.parameters[modelData.key])
                                    : modelData["default"]
                    onEdited: function (v) { bench.setEq(modelData.key, v) }
                }
            }
        }
    }
}
