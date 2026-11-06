import QtQuick
import QtTest
import "../../qml/tabs"

Item {
    width: 1400
    height: 900

    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        function get(path) { calls.push({ method: "GET", path: path }); }
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
        function del(path) { calls.push({ method: "DELETE", path: path }); }
    }

    PresetsTab { id: presets; width: 700; height: 400; client: fakeApi }
    EngineTab { id: engineTab; y: 400; width: 1400; height: 500; client: fakeApi; store: testStore }

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
    }
}
