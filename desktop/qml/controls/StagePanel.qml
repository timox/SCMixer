import QtQuick
import QtQuick.Layouts
import "Theme.js" as Theme

// Un étage de traitement (route PUT `path`) : un contrôle par champ applicable du descripteur.
// - `value` est l'objet confirmé par l'API ; une modification envoie l'objet complet de l'étage avec le
//   champ changé, sans rien modifier localement.
// - Sur un refus de l'API pour ce chemin, le message est affiché tel quel ; les contrôles affichent
//   toujours `value`, donc la valeur confirmée.
// - `context.width` (largeur de la source) et le modèle de l'étage décident des champs applicables
//   (`appliesTo` du descripteur).
Rectangle {
    id: panel
    property var client: null
    property string title: ""
    property string path: ""
    property var value: ({})
    property var descriptors: ({ fields: [] })
    property var context: ({})
    property var unavailableOptions: []
    property var hiddenKeys: []
    property alias errorText: banner.text
    default property alias extra: extraArea.data

    implicitWidth: Math.max(220, layout.implicitWidth + 20)
    implicitHeight: layout.implicitHeight + 20
    color: Theme.panel
    radius: 6
    border.color: Theme.line

    function applies(descriptor) {
        var a = descriptor.appliesTo;
        if (!a)
            return true;
        if (a.width) {
            var w = context.width;
            if (w !== undefined && ((a.width.min !== undefined && w < a.width.min) || (a.width.max !== undefined && w > a.width.max)))
                return false;
        }
        if (a.model && a.model.indexOf(value.model) < 0)
            return false;
        return true;
    }
    function send(key, v) {
        if (!client)
            return;
        var body = {};
        for (var k in value)
            body[k] = value[k];
        body[key] = v;
        errorText = "";
        client.put(path, body);
    }
    function control(key) {
        for (var i = 0; i < repeater.count; ++i) {
            var item = repeater.itemAt(i);
            if (item && item.key === key && item.visible)
                return item;
        }
        return null;
    }

    Connections {
        target: panel.client
        ignoreUnknownSignals: true
        function onRequestFailed(method, path, code, message) {
            if (path === panel.path)
                panel.errorText = message;
        }
    }

    ColumnLayout {
        id: layout
        x: 10
        y: 10
        width: panel.width - 20
        spacing: 6

        Text {
            text: panel.title
            color: Theme.dim
            font.pixelSize: 11
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1
            visible: panel.title !== ""
        }
        ErrorBanner { id: banner; Layout.fillWidth: true }
        Item { id: extraArea; Layout.fillWidth: true; implicitHeight: childrenRect.height; visible: children.length > 0 }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            Repeater {
                id: repeater
                model: panel.descriptors ? panel.descriptors.fields : []
                delegate: ParameterControl {
                    required property var modelData
                    descriptor: modelData
                    visible: panel.applies(modelData) && panel.hiddenKeys.indexOf(modelData.key) < 0
                    width: visible ? implicitWidth : 0
                    height: visible ? implicitHeight : 0
                    enabled: panel.enabled
                    confirmedValue: panel.value[modelData.key]
                    unavailable: modelData.key === "model" ? panel.unavailableOptions : []
                    onEdited: function (v) { panel.send(modelData.key, v) }
                }
            }
        }
    }
}
