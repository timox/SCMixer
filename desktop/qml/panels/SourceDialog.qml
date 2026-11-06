import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

// Création (POST /api/sources) ou modification (PATCH /api/sources/{id}) d'une source : nom, premier
// canal, largeur ; suppression après confirmation. Les bornes et chevauchements sont vérifiés par l'API,
// dont le message d'erreur est affiché tel quel.
Popup {
    id: dialog
    property var client: null
    property var source: null           // null : création
    readonly property string sourceId: source ? source.id : ""
    readonly property string path: source ? "/api/sources/" + source.id : "/api/sources"
    property string errorText: ""
    property bool confirmDelete: false

    modal: true
    focus: true
    padding: 14
    width: 360
    closePolicy: Popup.CloseOnEscape

    function openFor(s) {
        source = s;
        nameField.text = s ? s.name : "";
        firstField.text = s ? String(s.firstChannel) : "";
        widthField.text = s ? String(s.width) : "";
        errorText = "";
        confirmDelete = false;
        open();
    }
    function submit() {
        var body = { name: nameField.text, firstChannel: parseInt(firstField.text), width: parseInt(widthField.text) };
        errorText = "";
        if (source)
            client.patch(path, body);
        else
            client.post(path, body);
    }

    Connections {
        target: dialog.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path) {
            if (dialog.opened && path === dialog.path && (method === "POST" || method === "PATCH" || method === "DELETE"))
                dialog.close();
        }
        function onRequestFailed(method, path, code, message) {
            if (dialog.opened && path === dialog.path)
                dialog.errorText = message;
        }
    }

    background: Rectangle { color: Theme.panel; radius: 6; border.color: Theme.line }

    contentItem: ColumnLayout {
        spacing: 8
        Text {
            text: dialog.source ? "Modifier " + dialog.source.id : "Nouvelle source"
            color: Theme.text
            font.pixelSize: 14
            font.bold: true
        }
        GridLayout {
            columns: 2
            columnSpacing: 10
            Label { text: "Nom"; color: Theme.dim }
            TextField { id: nameField; objectName: "field-name"; Layout.fillWidth: true; maximumLength: 60 }
            Label { text: "Premier canal"; color: Theme.dim }
            TextField { id: firstField; objectName: "field-first"; Layout.fillWidth: true; validator: RegularExpressionValidator { regularExpression: /[0-9]{1,3}/ } }
            Label { text: "Largeur (canaux)"; color: Theme.dim }
            TextField { id: widthField; objectName: "field-width"; Layout.fillWidth: true; validator: RegularExpressionValidator { regularExpression: /[0-9]{1,3}/ } }
        }
        ErrorBanner { Layout.fillWidth: true; text: dialog.errorText; onTextChanged: dialog.errorText = text }
        RowLayout {
            Layout.fillWidth: true
            Toggle {
                visible: dialog.source !== null
                label: dialog.confirmDelete ? "Confirmer la suppression" : "Supprimer"
                onColor: Theme.mute
                checked: dialog.confirmDelete
                onToggled: {
                    if (dialog.confirmDelete)
                        dialog.client.del(dialog.path);
                    else
                        dialog.confirmDelete = true;
                }
            }
            Item { Layout.fillWidth: true }
            Toggle { label: "Annuler"; onToggled: dialog.close() }
            Toggle { objectName: "button-submit"; label: dialog.source ? "Enregistrer" : "Créer"; onToggled: dialog.submit() }
        }
    }
}
