import QtQuick
import QtTest
import "../../qml/tabs"
import "../../qml/panels"

Item {
    width: 1400
    height: 900

    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        signal eventReceived(string type, var data)
        function get(path) { calls.push({ method: "GET", path: path }); }
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
        function del(path) { calls.push({ method: "DELETE", path: path }); }
    }

    PresetsTab { id: presets; width: 700; height: 400; client: fakeApi }
    EngineTab { id: engineTab; y: 400; width: 1400; height: 500; client: fakeApi; store: testStore }
    EngineBar { id: bar; x: 700; width: 700; client: fakeApi; store: testStore; connected: true; baseUrl: "http://127.0.0.1:3100" }
    LogTab { id: logTab; x: 700; y: 40; width: 700; height: 360; client: fakeApi }

    function child(item, name) {
        if (!item)
            return null;
        if (item.objectName === name)
            return item;
        for (var i = 0; i < item.children.length; ++i) {
            var found = child(item.children[i], name);
            if (found)
                return found;
        }
        return null;
    }
    function gets(path) { return fakeApi.calls.filter(function (c) { return c.method === "GET" && c.path === path; }).length; }
    function posts(path) { return fakeApi.calls.filter(function (c) { return c.method === "POST" && c.path === path; }).length; }
    function engineState(status, audioClock) {
        var state = JSON.parse(JSON.stringify(stateFixture));
        state.engine.status = status;
        state.engine.audioClock = audioClock;
        return state;
    }

    TestCase {
        name: "PresetsMoteur"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; }

        function test_applyNeedsConfirmation() {
            fakeApi.responseReceived("GET", "/api/presets", [{ id: "preset-1", name: "Soirée", createdAt: "2026-11-06T00:00:00.000Z" }]);
            tryVerify(function () { return child(presets.list, "preset-preset-1") !== null; });
            var apply = child(child(presets.list, "preset-preset-1"), "apply");
            apply.toggled(true);
            compare(posts("/api/presets/preset-1/apply"), 0, "aucun appel sans confirmation");
            verify(apply.armed);
            apply.toggled(true);
            compare(posts("/api/presets/preset-1/apply"), 1);
        }

        function test_restoringDisablesLifecycle() {
            testBridge.applyState(engineState("restoring", null));
            verify(!engineTab.startButton.enabled);
            verify(!engineTab.stopButton.enabled);
            verify(!engineTab.restartButton.enabled);
            testBridge.applyState(engineState("stopped", null));
            verify(engineTab.startButton.enabled);
            verify(!engineTab.stopButton.enabled);
            engineTab.startButton.toggled(true);
            compare(posts("/api/engine/start"), 1);
        }

        function test_clockReadOnly() {
            testBridge.applyState(engineState("stopped", null));
            verify(engineTab.clockText.indexOf("moteur arrêté") >= 0, engineTab.clockText);
            compare(child(engineTab, "control-sampleRate"), null);
            compare(child(engineTab, "control-bufferFrames"), null);
            testBridge.applyState(engineState("running", { sampleRate: 48000, bufferFrames: 512 }));
            verify(engineTab.clockText.indexOf("48000 Hz") >= 0 && engineTab.clockText.indexOf("512") >= 0, engineTab.clockText);
        }

        function test_startErrorShownAsReturned() {
            testBridge.applyState(engineState("stopped", null));
            fakeApi.requestFailed("POST", "/api/engine/start", "TIMOXVASIO_NOT_READY", "TimoxVasio n'est pas prêt : transport arrêté.");
            compare(engineTab.errorText, "TimoxVasio n'est pas prêt : transport arrêté.");
        }

        function test_eqBenchStartsWithCatalogueDefaults() {
            testBridge.applyState(engineState("running", { sampleRate: 48000, bufferFrames: 512 }));
            child(engineTab, "button-eq-bench").toggled(true);
            var call = fakeApi.calls.filter(function (c) { return c.path === "/api/benches/eq/start"; })[0];
            verify(call !== undefined);
            compare(call.body.method, "threeBand");
            compare(call.body.parameters.low, 0.5);
        }

        function test_engineBarCommandsFollowStatus() {
            testBridge.applyState(engineState("stopped", null));
            verify(child(bar, "bar-start").enabled);
            verify(!child(bar, "bar-stop").enabled);
            verify(!child(bar, "bar-reset-all").enabled, "RAZ globale impossible moteur arrêté");
            child(bar, "bar-start").clicked();
            compare(posts("/api/engine/start"), 1);
            testBridge.applyState(engineState("running", { sampleRate: 48000, bufferFrames: 512 }));
            verify(!child(bar, "bar-start").enabled);
            child(bar, "bar-restart").clicked();
            compare(posts("/api/engine/restart"), 1);
            child(bar, "bar-stop").clicked();
            compare(posts("/api/engine/stop"), 1);
            verify(child(bar, "engine-status").text.indexOf("en marche") >= 0, child(bar, "engine-status").text);
            fakeApi.requestFailed("POST", "/api/engine/stop", "ENGINE_BUSY", "Le moteur change d'état.");
            compare(bar.errorText, "Le moteur change d'état.");
        }

        function test_globalResetNeedsConfirmation() {
            testBridge.applyState(engineState("running", { sampleRate: 48000, bufferFrames: 512 }));
            var reset = child(bar, "bar-reset-all");
            reset.toggled(true);
            compare(posts("/api/processing/reset"), 0, "aucun appel sans confirmation");
            verify(reset.armed);
            reset.toggled(true);
            compare(posts("/api/processing/reset"), 1);
        }

        function test_logLoadsThenAppendsEventsOnce() {
            logTab.lines.clear();
            logTab.lastSeq = 0;
            logTab.connected = false;
            logTab.connected = true;
            compare(gets("/api/engine/log?after=0"), 1);
            fakeApi.responseReceived("GET", "/api/engine/log?after=0", { lastSeq: 2, lines: [
                { seq: 1, time: "2026-11-06T10:00:00.000Z", stream: "service", text: "moteur running" },
                { seq: 2, time: "2026-11-06T10:00:01.000Z", stream: "stdout", text: "MX-SIZING {}" }] });
            compare(logTab.lines.count, 2);
            fakeApi.eventReceived("engineLog", { seq: 2, time: "2026-11-06T10:00:01.000Z", stream: "stdout", text: "MX-SIZING {}" });
            fakeApi.eventReceived("engineLog", { seq: 3, time: "2026-11-06T10:00:02.000Z", stream: "stderr", text: "ERROR: x" });
            compare(logTab.lines.count, 3, "ligne déjà affichée ignorée");
            compare(logTab.lines.get(2).message, "ERROR: x");
            logTab.connected = false;
            logTab.connected = true;
            compare(gets("/api/engine/log?after=3"), 1, "reconnexion : reprise après la dernière ligne");
        }
    }
}
