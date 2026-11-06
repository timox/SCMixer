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

    StageControls {
        id: lpPanel
        x: 100; y: 20
        width: 640
        client: fakeApi
        path: "/api/sources/src-2/processing/lp"
        descriptors: parametersFixture.source.lp
        value: stateFixture.sources[1].processing.lp
        context: ({ width: 2 })
        docs: graphsFixture.sources["src-2"].filter(function (s) { return s.stage === "lp"; })[0].docs
    }

    ChainStrip {
        id: chainStrip
        x: 20; y: 420
        width: 760
        chain: graphsFixture.outputs.master
        pageOf: function (stage) { return stage; }
        currentPage: "eq"
        property string lastPicked: ""
        onPicked: function (stage) { lastPicked = stage }
    }

    Knob {
        id: longLabel
        x: 20; y: 120
        label: "Pente au-dessus du seuil"
        from: 0; to: 1
        confirmedValue: 0.5
    }

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

        function test_longLabelWrapsWithoutTruncation() {
            var caption = child(longLabel, "knob-caption");
            verify(caption !== null);
            verify(!caption.truncated, "libellé non tronqué");
            verify(caption.contentHeight <= caption.height + 1, "contenu dans la hauteur réservée");
        }

        function test_frequencyShownInHzFromPublishedConversion() {
            var freq = lpPanel.control("freq").editor;
            var v = lpPanel.value;
            var hz = v.minHz * Math.pow(v.maxHz / v.minHz, v.freq);
            verify(freq.valueText.indexOf("Hz") > 0, freq.valueText);
            var shown = parseFloat(freq.valueText) * (freq.valueText.indexOf("kHz") > 0 ? 1000 : 1);
            verify(Math.abs(shown - hz) / hz < 0.01, freq.valueText + " / " + hz);
        }

        function test_previewFollowsDragWithoutSending() {
            var control = lpPanel.control("freq");
            control.previewChanged("freq", true, 0.2);
            verify(lpPanel.dragging);
            compare(lpPanel.preview.freq, 0.2);
            compare(lpPanel.value.freq, stateFixture.sources[1].processing.lp.freq, "état confirmé inchangé");
            compare(fakeApi.calls.length, 0, "l'aperçu n'envoie rien");
            control.previewChanged("freq", false, 0.2);
            verify(!lpPanel.dragging);
            compare(lpPanel.preview.freq, lpPanel.value.freq);
        }

        function test_advancedFieldsFoldedAndStateFirst() {
            var adv = parametersFixture.source.lp.fields.filter(function (f) { return f.group === "advanced"; });
            verify(adv.length > 0);
            compare(lpPanel.advancedFields.length, adv.length);
            compare(lpPanel.barFields[0].key, "enabled", "champ d'état en tête de barre");
            verify(lpPanel.mainFields.every(function (f) { return f.group === "main" && f.type !== "boolean" && f.type !== "enum"; }));
        }

        function test_docLinksFromProcessingGraph() {
            var model = stateFixture.sources[1].processing.lp.model;
            var link = child(lpPanel, "doc-" + model);
            verify(link !== null, "lien vers l'aide de " + model);
            verify(link.text.indexOf("https://doc.sccode.org/Classes/" + model + ".html") >= 0, link.text);
        }

        function test_chainStripOrderStateAndPick() {
            var stages = graphsFixture.outputs.master.map(function (s) { return s.stage; });
            for (var i = 0; i < stages.length; ++i)
                verify(child(chainStrip, "block-" + stages[i]) !== null, stages[i]);
            var infra = child(chainStrip, "block-infraHpf");
            compare(child(infra, "led").color.a > 0, graphsFixture.outputs.master[0].enabled);
            mouseClick(child(chainStrip, "block-eq"));
            compare(chainStrip.lastPicked, "eq");
        }

        function test_chainStripFlagsUnloadedModel() {
            var chain = JSON.parse(JSON.stringify(graphsFixture.outputs.master));
            var comp = chain[chain.length - 1];
            comp.requestedModel = "FaustRMS";
            comp.loadedModel = null;
            chainStrip.chain = chain;
            verify(child(child(chainStrip, "block-compressor"), "mismatch").visible);
            chainStrip.chain = graphsFixture.outputs.master;
            verify(!child(child(chainStrip, "block-compressor"), "mismatch").visible);
        }
    }
}
