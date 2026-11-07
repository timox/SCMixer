import QtQuick
import QtQuick.Layouts
import "Theme.js" as Theme
import "Contract.js" as Contract

// Réglages d'un étage de traitement (route PUT `path`), construits depuis le catalogue de l'API :
// - barre d'étage : titre, champ d'état (state du catalogue), modèles et autres booléens, actions
//   (enfants du composant) et liens vers l'aide des UGens utilisés (`docs`, fournis par processing-graph) ;
// - réglages principaux (group main), puis « Avancé » replié (group advanced) ;
// - les champs non applicables (appliesTo : largeur, modèle) sont masqués.
// `keys` (facultatif) restreint l'affichage à ces champs, dans cet ordre (colonnes d'un même étage).
// « Réinitialiser » (POST `path`/reset) rétablit les défauts de tout l'étage : présent par défaut
// seulement quand l'étage est affiché en entier (`resettable`).
// Une modification envoie l'objet complet de l'étage ; l'affichage suit `value` (état confirmé).
// Pendant un glissement, `preview` vaut `value` avec la position en cours : les graphes en tracent un
// aperçu, rien n'est écrit dans le magasin ni envoyé en plus.
Rectangle {
    id: panel
    property var client: null
    property string title: ""
    property color titleColor: Theme.text
    property string path: ""
    property var value: ({})
    property var descriptors: ({ fields: [] })
    property var context: ({})
    property var unavailableOptions: []
    property var docs: []
    property bool dense: false
    property bool advancedOpen: false
    property var keys: []
    property bool resettable: keys.length === 0
    property alias errorText: banner.text
    default property alias actions: actionRow.data

    property var draft: ({})
    readonly property bool dragging: Object.keys(draft).length > 0
    readonly property var preview: {
        var merged = {};
        for (var k in value) merged[k] = value[k];
        for (var d in draft) merged[d] = draft[d];
        return merged;
    }
    readonly property bool active: Contract.active(descriptors, value)
    readonly property var fields: {
        var all = descriptors && descriptors.fields ? descriptors.fields : [];
        if (!keys || keys.length === 0)
            return all;
        var out = [];
        for (var i = 0; i < keys.length; ++i)
            for (var j = 0; j < all.length; ++j)
                if (all[j].key === keys[i])
                    out.push(all[j]);
        return out;
    }
    readonly property var stateKey: descriptors && descriptors.state ? descriptors.state.field : ""

    function applicable(f) { return Contract.applies(f, value, context); }
    function inBar(f) { return f.type === "boolean" || f.type === "enum"; }
    function pick(group) {
        return fields.filter(function (f) {
            return !panel.inBar(f) && (f.group || "main") === group && panel.applicable(f);
        });
    }
    readonly property var barFields: {
        var list = fields.filter(function (f) { return panel.inBar(f) && panel.applicable(f); });
        // Le champ d'état en premier.
        return list.sort(function (a, b) {
            if (a.key === "inserted") return -1;
            if (b.key === "inserted") return 1;
            return (b.key === panel.stateKey) - (a.key === panel.stateKey);
        });
    }
    readonly property var mainFields: pick("main")
    readonly property var advancedFields: pick("advanced")

    function send(key, v) {
        if (!client)
            return;
        errorText = "";
        client.put(path, Contract.withField(value, key, v));
    }
    function onPreview(key, on, v) {
        if (on) {
            var d = {};
            d[key] = v;
            draft = d;
        } else {
            draft = ({});
        }
    }
    function control(key) {
        var lists = [barRepeater, mainRepeater, advancedRepeater];
        for (var l = 0; l < lists.length; ++l)
            for (var i = 0; i < lists[l].count; ++i) {
                var item = lists[l].itemAt(i);
                if (item && item.key === key)
                    return item;
            }
        return null;
    }

    Connections {
        target: panel.client
        ignoreUnknownSignals: true
        function onRequestFailed(method, path, code, message) {
            if (path === panel.path || path === panel.path + "/reset")
                panel.errorText = message;
        }
    }

    implicitWidth: layout.implicitWidth + 24
    implicitHeight: layout.implicitHeight + 20
    color: Theme.panel
    radius: 6
    border.color: Theme.line
    opacity: active ? 1 : 0.85

    ColumnLayout {
        id: layout
        x: 12
        y: 10
        width: panel.width - 24
        spacing: 8

        // Barre d'étage.
        Flow {
            Layout.fillWidth: true
            spacing: 10
            Text {
                height: 24
                verticalAlignment: Text.AlignVCenter
                visible: panel.title !== ""
                text: panel.title
                color: panel.active ? panel.titleColor : Theme.dim
                font.pixelSize: Theme.fontTitle
                font.bold: true
            }
            Repeater {
                id: barRepeater
                model: panel.barFields
                delegate: ParameterControl {
                    required property var modelData
                    descriptor: modelData
                    enabled: panel.enabled
                    confirmedValue: panel.value[modelData.key]
                    stageValue: panel.value
                    unavailable: modelData.key === "model" ? panel.unavailableOptions : []
                    onEdited: function (v) { panel.send(modelData.key, v) }
                }
            }
            ActionButton {
                objectName: "button-reset"
                visible: panel.resettable && panel.path !== ""
                enabled: panel.enabled
                label: "Réinitialiser"
                onClicked: { panel.errorText = ""; panel.client.post(panel.path + "/reset"); }
            }
            Row { id: actionRow; spacing: 6 }
            Row {
                spacing: 6
                visible: panel.docs.length > 0
                height: 24
                Text { anchors.verticalCenter: parent.verticalCenter; text: "Aide :"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
                Repeater {
                    model: panel.docs
                    delegate: Text {
                        required property var modelData
                        objectName: "doc-" + modelData.name
                        anchors.verticalCenter: parent.verticalCenter
                        textFormat: Text.StyledText
                        text: modelData.url ? "<a href=\"" + modelData.url + "\">" + modelData.name + "</a>" : modelData.name
                        linkColor: Theme.accent
                        color: Theme.dim
                        font.pixelSize: Theme.fontSmall
                        onLinkActivated: function (link) { Qt.openUrlExternally(link) }
                        HoverHandler { cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor : Qt.ArrowCursor }
                    }
                }
            }
        }
        ErrorBanner { id: banner; Layout.fillWidth: true }

        Flow {
            Layout.fillWidth: true
            spacing: 4
            Repeater {
                id: mainRepeater
                model: panel.mainFields
                delegate: ParameterControl {
                    required property var modelData
                    descriptor: modelData
                    dense: panel.dense
                    enabled: panel.enabled
                    confirmedValue: panel.value[modelData.key]
                    stageValue: panel.value
                    onEdited: function (v) { panel.send(modelData.key, v) }
                    onPreviewChanged: function (key, on, v) { panel.onPreview(key, on, v) }
                }
            }
        }

        Text {
            objectName: "toggle-advanced"
            visible: panel.advancedFields.length > 0
            text: (panel.advancedOpen ? "▾ " : "▸ ") + "Avancé (" + panel.advancedFields.length + ")"
            color: Theme.dim
            font.pixelSize: Theme.fontSmall
            MouseArea { anchors.fill: parent; onClicked: panel.advancedOpen = !panel.advancedOpen }
        }
        Flow {
            Layout.fillWidth: true
            visible: panel.advancedOpen
            spacing: 4
            Repeater {
                id: advancedRepeater
                model: panel.advancedFields
                delegate: ParameterControl {
                    required property var modelData
                    descriptor: modelData
                    dense: true
                    enabled: panel.enabled
                    confirmedValue: panel.value[modelData.key]
                    stageValue: panel.value
                    onEdited: function (v) { panel.send(modelData.key, v) }
                    onPreviewChanged: function (key, on, v) { panel.onPreview(key, on, v) }
                }
            }
        }
    }
}
