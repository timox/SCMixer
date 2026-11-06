import QtQuick
import QtQuick.Controls
import "../controls"
import "../controls/Theme.js" as Theme

// Arbre des nœuds de scsynth (GET /api/engine/node-tree), relu à la demande.
Rectangle {
    id: tree
    property var client: null
    property var nodes: []
    readonly property string path: "/api/engine/node-tree"

    function refresh() { if (client) client.get(path); }
    function depthOf(node, byId) {
        var depth = 0;
        for (var p = byId[node.parentId]; p; p = byId[p.parentId])
            depth += 1;
        return depth;
    }

    color: Theme.panel
    radius: 6
    border.color: Theme.line

    Connections {
        target: tree.client
        ignoreUnknownSignals: true
        function onResponseReceived(method, path, body) {
            if (path !== tree.path)
                return;
            var byId = {};
            body.nodes.forEach(function (n) { byId[n.nodeId] = n; });
            tree.nodes = body.nodes.map(function (n) { return { node: n, depth: tree.depthOf(n, byId) }; });
        }
    }

    Column {
        id: header
        x: 10; y: 8
        spacing: 4
        Row {
            spacing: 8
            Text { text: "ARBRE DES NŒUDS"; color: Theme.dim; font.pixelSize: 11; font.letterSpacing: 1 }
            Toggle { label: "Actualiser"; onToggled: tree.refresh() }
            Text { text: tree.nodes.length + " nœud(s)"; color: Theme.dim; font.pixelSize: Theme.fontSmall }
        }
    }
    ListView {
        anchors.top: header.bottom
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.margins: 10
        clip: true
        model: tree.nodes
        ScrollBar.vertical: ScrollBar {}
        delegate: Text {
            required property var modelData
            x: modelData.depth * 14
            text: (modelData.node.kind === "group" ? "Groupe " : "") + modelData.node.nodeId
                  + (modelData.node.synthDef ? " " + modelData.node.synthDef : "")
            color: modelData.node.kind === "group" ? Theme.dim : Theme.text
            font.pixelSize: Theme.fontSmall
            font.family: "Consolas"
        }
    }
}
