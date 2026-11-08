import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../controls"
import "../controls/Theme.js" as Theme

Item {
    id: tab
    property var client: null
    property var operations: []
    property var selectedOperation: null
    property string errorText: ""
    readonly property var visibleOperations: {
        var query = search.text.toLowerCase().trim();
        return operations.filter(function (item) {
            return !query || (item.method + " " + item.path + " " + item.summary).toLowerCase().indexOf(query) >= 0;
        });
    }

    function load() {
        errorText = "";
        if (client && client.connected)
            client.get("/api/openapi.json");
    }
    function readOperations(document) {
        var rows = [];
        var paths = document.paths || {};
        var methods = ["get", "put", "post", "patch", "delete"];
        for (var path in paths) {
            for (var i = 0; i < methods.length; ++i) {
                var method = methods[i];
                var operation = paths[path][method];
                if (!operation)
                    continue;
                rows.push({ method: method.toUpperCase(), path: path, summary: operation.summary || "", details: JSON.stringify({
                    tags: operation.tags || [], description: operation.description || "",
                    parameters: paths[path].parameters || [], operation: operation
                }, null, 2) });
            }
        }
        rows.sort(function (a, b) { return a.path.localeCompare(b.path) || a.method.localeCompare(b.method); });
        operations = rows;
        selectedOperation = rows.length ? rows[0] : null;
    }

    onVisibleChanged: if (visible) load()
    Connections {
        target: tab.client
        ignoreUnknownSignals: true
        function onConnectedChanged() { if (tab.visible) tab.load() }
        function onResponseReceived(method, path, body) {
            if (method === "GET" && path === "/api/openapi.json")
                tab.readOperations(body);
        }
        function onRequestFailed(method, path, code, message) {
            if (method === "GET" && path === "/api/openapi.json")
                tab.errorText = message;
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8
        RowLayout {
            Layout.fillWidth: true
            ColumnLayout {
                Layout.fillWidth: true
                Text { text: "API SCMixer"; color: Theme.text; font.pixelSize: Theme.fontTitle; font.bold: true }
                Text { text: "OpenAPI " + (tab.client && tab.operations.length ? "3.1 · " + tab.operations.length + " opérations" : "3.1"); color: Theme.dim; font.pixelSize: Theme.fontSmall }
            }
            TextField {
                id: search
                objectName: "api-search"
                Layout.preferredWidth: 320
                placeholderText: "Filtrer méthode, route ou résumé"
                Accessible.name: "Filtrer les opérations de l’API"
            }
            ActionButton { label: "Actualiser"; onClicked: tab.load() }
        }
        ErrorBanner { Layout.fillWidth: true; text: tab.errorText }
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10
            ListView {
                id: operationList
                objectName: "api-operations"
                Layout.preferredWidth: 560
                Layout.fillHeight: true
                clip: true
                spacing: 4
                model: tab.visibleOperations
                ScrollBar.vertical: ScrollBar {}
                delegate: Button {
                    required property var modelData
                    width: ListView.view.width - 8
                    height: 58
                    text: modelData.method + "   " + modelData.path + "\n" + modelData.summary
                    onClicked: tab.selectedOperation = modelData
                }
            }
            Rectangle { Layout.fillHeight: true; implicitWidth: 1; color: Theme.line }
            ColumnLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Text {
                    Layout.fillWidth: true
                    text: tab.selectedOperation ? tab.selectedOperation.method + "  " + tab.selectedOperation.path : "Sélectionne une opération"
                    color: Theme.text
                    font.pixelSize: Theme.fontNormal
                    font.bold: true
                    wrapMode: Text.WrapAnywhere
                }
                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    TextArea {
                        text: tab.selectedOperation ? tab.selectedOperation.details : ""
                        readOnly: true
                        selectByMouse: true
                        wrapMode: TextEdit.NoWrap
                        font.family: "Consolas"
                        font.pixelSize: Theme.fontSmall
                        color: Theme.text
                        background: Rectangle { color: Theme.panel; radius: 4; border.color: Theme.line }
                    }
                }
            }
        }
    }
}
