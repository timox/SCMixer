import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Onglet Presets : liste (GET /api/presets), enregistrement de la session courante, application après
// confirmation (remplace toute la session), suppression après confirmation.
Item {
    id: tab
    property var client: null
    property var presets: []
    property string errorText: ""
    property alias list: presetList

    function refresh() { if (client) client.get("/api/presets"); }
    function save() { errorText = ""; client.post("/api/presets", { name: nameField.text }); }
    function apply(id) { errorText = ""; client.post("/api/presets/" + id + "/apply"); }
    function remove(id) { errorText = ""; client.del("/api/presets/" + id); }

    Component.onCompleted: refresh()
    onVisibleChanged: if (visible) refresh()

    Connections {
        target: tab.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (path === "/api/presets" && method === "GET")
                tab.presets = body;
            else if (path.indexOf("/api/presets") === 0)
                tab.refresh();
            if (path === "/api/presets" && method === "POST")
                nameField.text = "";
        }
        function onRequestFailed(method, path, code, message) {
            if (path.indexOf("/api/presets") === 0)
                tab.errorText = message;
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            Label { text: "Nom du preset"; color: Theme.dim }
            TextField { id: nameField; objectName: "field-preset-name"; Layout.preferredWidth: 320 }
            Toggle { objectName: "button-save"; label: "Enregistrer la session"; onToggled: tab.save() }
            Item { Layout.fillWidth: true }
            Toggle { label: "Actualiser"; onToggled: tab.refresh() }
        }
        Text {
            text: "Un preset est un instantané complet : sources, réglages, Master et Cue. L'appliquer remplace toute la session."
            color: Theme.dim
            font.pixelSize: Theme.fontSmall
        }
        ErrorBanner { Layout.fillWidth: true; text: tab.errorText; onTextChanged: tab.errorText = text }

        ListView {
            id: presetList
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: 4
            model: tab.presets
            delegate: Rectangle {
                required property var modelData
                objectName: "preset-" + modelData.id
                width: presetList.width
                height: 40
                radius: 4
                color: Theme.panel
                border.color: Theme.line
                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 8
                    Text { text: modelData.name; color: Theme.text; font.pixelSize: Theme.fontNormal; Layout.fillWidth: true; elide: Text.ElideRight }
                    Text { text: modelData.id + " · " + new Date(modelData.createdAt).toLocaleString(Qt.locale(), Locale.ShortFormat); color: Theme.dim; font.pixelSize: Theme.fontSmall }
                    ConfirmButton {
                        objectName: "apply"
                        text: "Appliquer"
                        confirmText: "Confirmer : remplace toute la session"
                        onConfirmed: tab.apply(modelData.id)
                    }
                    ConfirmButton {
                        objectName: "delete"
                        text: "Supprimer"
                        confirmText: "Confirmer la suppression"
                        onConfirmed: tab.remove(modelData.id)
                    }
                }
            }
        }
    }
}
