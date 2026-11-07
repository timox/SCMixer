// Prérequis vérifiés avant toute installation : Node.js (exécute le service moteur) et le pilote ASIO
// TimoxVasio (seul périphérique audio du moteur ; son pilote doit déjà être installé). Un prérequis absent : message
// explicite et arrêt de l'installation. La désinstallation n'est pas concernée.

function Controller()
{
}

function missingPrerequisites()
{
    var missing = [];
    var node = installer.execute("cmd", ["/c", "node --version"]);
    if (!node || node.length < 2 || node[1] !== 0 || String(node[0]).indexOf("v") !== 0)
        missing.push("Node.js est introuvable (commande « node » absente du PATH). Installer Node.js 22 ou plus récent.");
    var asio = installer.execute("reg", ["query", "HKLM\\SOFTWARE\\ASIO\\TimoxVasio"]);
    if (!asio || asio.length < 2 || asio[1] !== 0)
        missing.push("Le pilote ASIO TimoxVasio n'est pas enregistré (clé HKLM\\SOFTWARE\\ASIO\\TimoxVasio absente). Installer TimoxVasio avant SCMixer.");
    return missing;
}

Controller.prototype.IntroductionPageCallback = function ()
{
    if (!installer.isInstaller())
        return;
    var missing = missingPrerequisites();
    if (missing.length === 0)
        return;
    QMessageBox.critical("scmixer.prerequisites", "Prérequis manquants",
                         missing.join("\n\n") + "\n\nL'installation est arrêtée.", QMessageBox.Ok);
    gui.rejectWithoutPrompt();
};
