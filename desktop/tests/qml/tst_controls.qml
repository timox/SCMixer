import QtQuick
import QtTest
import "../../qml/controls"

Item {
    id: root
    width: 800
    height: 600

    // Faux client : enregistre les appels, émet requestFailed comme ApiClient.
    QtObject {
        id: fakeApi
        property var calls: []
        signal requestFailed(string method, string path, string code, string message)
        function put(path, body) { calls.push({ method: "PUT", path: path, body: body }); }
        function post(path, body) { calls.push({ method: "POST", path: path, body: body }); }
    }

    Knob {
        id: knob
        x: 20; y: 20
        from: 0; to: 1; stepSize: 0; defaultValue: 0.5
        confirmedValue: 0.25
        property var movedValues: []
        onMoved: function (v) { movedValues.push(v) }
    }

    StagePanel {
        id: lpPanel
        x: 100; y: 20
        width: 600
        client: fakeApi
        path: "/api/sources/src-2/processing/lp"
        descriptors: parametersFixture.source.lp
        value: stateFixture.sources[1].processing.lp
        context: ({ width: 2 })
    }

    function findDescriptor(stage, key) {
        return stage.fields.filter(function (f) { return f.key === key; })[0];
    }

    TestCase {
        name: "Controles"
        when: windowShown

        function init() { fakeApi.calls = []; knob.movedValues = []; lpPanel.errorText = ""; }

        function test_knobDragThenReturnsToConfirmed() {
            mousePress(knob, 28, 30);
            mouseMove(knob, 28, 10);
            mouseMove(knob, 28, 0);
            verify(knob.dragging, "glissement en cours");
            verify(knob.movedValues.length > 0, "moved émis pendant le glissement");
            verify(knob.displayedValue > 0.25, "l'affichage suit la souris");
            mouseRelease(knob, 28, 0);
            compare(knob.displayedValue, 0.25, "au relâchement, l'affichage reprend la valeur confirmée");
        }

        function test_knobDoubleClickSendsDefault() {
            mouseDoubleClickSequence(knob, 28, 30);
            compare(knob.movedValues[knob.movedValues.length - 1], 0.5);
        }

        function test_stagePanelSendsWholeStage() {
            var q = lpPanel.control("q");
            verify(q !== null);
            q.edited(2.5);
            compare(fakeApi.calls.length, 1);
            compare(fakeApi.calls[0].path, "/api/sources/src-2/processing/lp");
            compare(fakeApi.calls[0].body.q, 2.5);
            compare(fakeApi.calls[0].body.model, lpPanel.value.model);
            compare(Object.keys(fakeApi.calls[0].body).length, Object.keys(lpPanel.value).length);
        }

        function test_stagePanelShowsApiErrorAndKeepsConfirmed() {
            var freq = lpPanel.control("freq").editor;
            fakeApi.requestFailed("PUT", "/api/sources/src-9/processing/lp", "VALIDATION", "autre chemin");
            compare(lpPanel.errorText, "");
            fakeApi.requestFailed("PUT", "/api/sources/src-2/processing/lp", "MODEL_UNAVAILABLE", "Modèle refusé.");
            compare(lpPanel.errorText, "Modèle refusé.");
            compare(freq.displayedValue, lpPanel.value.freq);
        }

        function test_fieldsFollowModelAndDescriptorBounds() {
            compare(lpPanel.control("gain"), null, "gain masqué hors MoogFF");
            verify(lpPanel.control("q") !== null, "q visible pour BLowPass");
            var moog = {};
            for (var k in lpPanel.value) moog[k] = lpPanel.value[k];
            moog.model = "MoogFF";
            lpPanel.value = moog;
            verify(lpPanel.control("gain") !== null, "gain visible pour MoogFF");
            compare(lpPanel.control("q"), null, "q masqué pour MoogFF");
            var d = findDescriptor(parametersFixture.source.lp, "freq");
            var freq = lpPanel.control("freq").editor;
            compare(freq.from, d.min);
            compare(freq.to, d.max);
            lpPanel.value = stateFixture.sources[1].processing.lp;
        }
    }
}
