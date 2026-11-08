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

function removePreviousInstallation()
{
    var target = installer.value("TargetDir");
    var maintenanceTool = target + "/Desinstaller-SCMixer.exe";
    if (!installer.fileExists(maintenanceTool))
        return true;

    var answer = QMessageBox.question(
        "scmixer.upgrade", "Mise à niveau de SCMixer",
        "Une installation de SCMixer existe déjà dans :\n" + target +
        "\n\nElle sera désinstallée avant l'installation de cette version. Les sessions dans %LOCALAPPDATA%\\SCMixer seront conservées. Continuer ?",
        QMessageBox.Yes | QMessageBox.No, QMessageBox.No);
    if (answer !== QMessageBox.Yes)
        return false;

    var result = installer.execute(maintenanceTool, ["--confirm-command", "purge"]);
    if (result && result.length >= 2 && result[1] === 0)
        return true;

    QMessageBox.critical("scmixer.upgrade.failed", "Désinstallation impossible",
                         "L'installation précédente n'a pas pu être supprimée. SCMixer n'a pas été modifié.",
                         QMessageBox.Ok);
    return false;
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
    return;
};

Controller.prototype.TargetDirectoryPageCallback = function ()
{
    if (!installer.isInstaller())
        return;
    var hadPreviousInstallation = installer.fileExists(installer.value("TargetDir") + "/Desinstaller-SCMixer.exe");
    if (!removePreviousInstallation()) {
        gui.rejectWithoutPrompt();
        return;
    }
    if (hadPreviousInstallation)
        gui.currentPageWidget().TargetDirectoryLineEdit.setEnabled(false);
};
