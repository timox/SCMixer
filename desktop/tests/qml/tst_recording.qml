import QtQuick
import QtTest
import "../../qml/panels"

Item {
    width: 900
    height: 100

    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        signal responseReceived(string method, string path, var body)
        signal eventReceived(string type, var data)
        function get(path) { calls.push({ method: "GET", path: path }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
    }

    RecordBar { id: rec; width: 900; client: fakeApi; store: testStore; connected: true }

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
    function lastPost(path) {
        var list = fakeApi.calls.filter(function (c) { return c.method === "POST" && c.path === path; });
        return list.length ? list[list.length - 1] : null;
    }
    function recording(over) {
        var r = { state: "stopped", file: null, sampleFormat: null, sampleRate: null, channels: 2,
                  recordedSeconds: 0, bytes: 0, stopReason: null, error: null };
        for (var k in over)
            r[k] = over[k];
        return r;
    }
    function setRunning(rec) {
        var state = JSON.parse(JSON.stringify(stateFixture));
        state.engine.status = "running";
        state.recording = rec;
        testBridge.applyState(state);
    }

    TestCase {
        name: "Enregistrement"
        when: windowShown

        function init() { testBridge.reset(); fakeApi.calls = []; }

        function test_stoppedOnlyStartEnabled() {
            setRunning(recording({}));
            verify(child(rec, "rec-start").enabled);
            verify(child(rec, "rec-format").enabled);
            verify(!child(rec, "rec-pause").enabled);
            verify(!child(rec, "rec-resume").enabled);
            verify(!child(rec, "rec-stop").enabled);
        }

        function test_startNeedsRunningEngine() {
            var state = JSON.parse(JSON.stringify(stateFixture));
            state.engine.status = "stopped";
            state.recording = recording({});
            testBridge.applyState(state);
            verify(!child(rec, "rec-start").enabled);
        }

        function test_startSendsChosenFormat() {
            setRunning(recording({}));
            var format = child(rec, "rec-format");
            compare(format.currentValue, "int24", "24 bits par défaut");
            format.currentIndex = 2;
            child(rec, "rec-start").clicked();
            compare(lastPost("/api/recording/start").body.sampleFormat, "float");
        }

        function test_recordingAndPausedCommands() {
            setRunning(recording({ state: "recording", sampleFormat: "int24", sampleRate: 48000 }));
            verify(child(rec, "rec-pause").enabled);
            verify(child(rec, "rec-stop").enabled);
            verify(!child(rec, "rec-format").enabled);
            verify(!child(rec, "rec-start").enabled);
            child(rec, "rec-pause").clicked();
            verify(lastPost("/api/recording/pause") !== null);
            testBridge.applyEvent("recordingChanged", recording({ state: "paused", sampleFormat: "int24", sampleRate: 48000 }));
            verify(child(rec, "rec-resume").enabled);
            verify(!child(rec, "rec-pause").enabled);
            child(rec, "rec-resume").clicked();
            verify(lastPost("/api/recording/resume") !== null);
            child(rec, "rec-stop").clicked();
            verify(lastPost("/api/recording/stop") !== null);
        }

        function test_statusShowsPublishedValues() {
            setRunning(recording({ state: "recording", recordedSeconds: 65, bytes: 12500000,
                                file: "C:/x/2026-11-06_21-04-33_master.wav", sampleFormat: "int24", sampleRate: 48000 }));
            var text = child(rec, "rec-status").text;
            verify(text.indexOf("0:01:05") >= 0, text);
            verify(text.indexOf("12.5 Mo") >= 0, text);
            verify(text.indexOf("2026-11-06_21-04-33_master.wav") >= 0, text);
            verify(text.indexOf("C:/x") < 0, "nom seul : " + text);
        }

        function test_stopReasonShown() {
            setRunning(recording({ state: "stopped", stopReason: "sizeLimit", file: "C:/x/a.wav", sampleFormat: "float", sampleRate: 48000 }));
            verify(child(rec, "rec-status").text.indexOf("taille limite atteinte") >= 0, child(rec, "rec-status").text);
            testBridge.applyEvent("recordingChanged", recording({ stopReason: "error", error: "Espace disque insuffisant." }));
            verify(child(rec, "rec-status").text.indexOf("erreur : Espace disque insuffisant.") >= 0, child(rec, "rec-status").text);
        }

        function test_requestErrorShown() {
            setRunning(recording({}));
            fakeApi.requestFailed("POST", "/api/recording/start", "RECORDING_FILE_EXISTS", "Le fichier existe déjà.");
            compare(child(rec, "rec-error").text, "Le fichier existe déjà.");
        }
    }
}
