
import { db } from "./firebase.js";

import {
    doc,
    setDoc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ========================================
// ELEMENTOS HTML
// ========================================

const $ = id => document.getElementById(id);

const settingsForm = $("settingsForm");

const settingsInstitutionName =
    $("settingsInstitutionName");

const settingsInstitutionEmail =
    $("settingsInstitutionEmail");

const settingsInstitutionPhone =
    $("settingsInstitutionPhone");

const settingsInstitutionAddress =
    $("settingsInstitutionAddress");

const settingsMessage =
    $("settingsMessage");

const saveSettingsButton =
    $("saveSettingsButton");

const settingsAdminName =
    $("settingsAdminName");

const settingsAdminEmail =
    $("settingsAdminEmail");

const settingsConnectionStatus =
    $("settingsConnectionStatus");

const settingsCurrentRole =
    $("settingsCurrentRole");

const institutionFields = [
    settingsInstitutionName,
    settingsInstitutionEmail,
    settingsInstitutionPhone,
    settingsInstitutionAddress
];

// ========================================
// ESTADO DEL MÓDULO
// ========================================

let currentUser = null;
let isAdmin = false;

let sessionRevision = 0;

let unsubscribeSettings = null;

let settingsLoaded = false;
let serverConnected = false;
let savingSettings = false;
let settingsDirty = false;
let remoteChanged = false;

let lastServerData = null;

// ========================================
// DOCUMENTO DE CONFIGURACIÓN
// ========================================

const settingsRef = doc(
    db,
    "configuracion",
    "institucion"
);

// ========================================
// FUNCIONES AUXILIARES
// ========================================

function clean(value) {
    return String(value ?? "").trim();
}

function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        email.length <= 254;
}

function hasAdminAccess() {
    return currentUser !== null &&
        isAdmin === true;
}

function validSession(revision) {
    return revision === sessionRevision &&
        hasAdminAccess();
}

function canEditSettings() {
    return hasAdminAccess() &&
        settingsLoaded &&
        !savingSettings;
}

function canSaveSettings() {
    return canEditSettings() &&
        serverConnected;
}

// ========================================
// MENSAJES
// ========================================

function showSettingsMessage(
    message,
    isError = false
) {
    settingsMessage.textContent = message;

    settingsMessage.style.color = isError
        ? "#dc2626"
        : "#16a34a";
}

// ========================================
// CONTROL DE FORMULARIOS
// ========================================

function updateFormAccess() {
    const editable = canEditSettings();

    institutionFields.forEach(field => {
        field.disabled = !editable;
    });

    saveSettingsButton.disabled =
        !canSaveSettings();

    saveSettingsButton.textContent =
        savingSettings
            ? "Guardando..."
            : "Guardar configuración";

    settingsAdminName.readOnly = true;
    settingsAdminEmail.readOnly = true;
}

// ========================================
// LIMPIAR CONFIGURACIÓN
// ========================================

function clearSettings() {
    institutionFields.forEach(field => {
        field.value = "";
    });
}

// ========================================
// INFORMACIÓN DE LA CUENTA
// ========================================

function renderAccount() {
    if (!currentUser) {
        settingsAdminName.value =
            "Sin conectar";

        settingsAdminEmail.value = "";

        settingsCurrentRole.textContent =
            "Sin conectar";

        return;
    }

    settingsAdminName.value =
        currentUser.displayName ||
        "Usuario Google";

    settingsAdminEmail.value =
        currentUser.email || "";

    settingsCurrentRole.textContent =
        isAdmin
            ? "Administrador"
            : "Docente";
}

// ========================================
// NORMALIZAR DATOS INSTITUCIONALES
// ========================================

function normalizeSettings(data = {}) {
    return {
        institutionName:
            clean(data.institutionName),

        institutionEmail:
            clean(data.institutionEmail),

        institutionPhone:
            clean(data.institutionPhone),

        institutionAddress:
            clean(data.institutionAddress)
    };
}

// ========================================
// LEER DATOS DEL FORMULARIO
// ========================================

function readSettingsForm() {
    return {
        institutionName:
            clean(settingsInstitutionName.value),

        institutionEmail:
            clean(settingsInstitutionEmail.value)
                .toLowerCase(),

        institutionPhone:
            clean(settingsInstitutionPhone.value),

        institutionAddress:
            clean(settingsInstitutionAddress.value)
    };
}

// ========================================
// COMPARAR CONFIGURACIONES
// ========================================

function sameSettings(first, second) {
    if (!first || !second) return false;

    return (
        first.institutionName ===
            second.institutionName &&

        first.institutionEmail ===
            second.institutionEmail &&

        first.institutionPhone ===
            second.institutionPhone &&

        first.institutionAddress ===
            second.institutionAddress
    );
}

// ========================================
// MOSTRAR DATOS INSTITUCIONALES
// ========================================

function renderSettings(data) {
    const normalized =
        normalizeSettings(data);

    settingsInstitutionName.value =
        normalized.institutionName;

    settingsInstitutionEmail.value =
        normalized.institutionEmail;

    settingsInstitutionPhone.value =
        normalized.institutionPhone;

    settingsInstitutionAddress.value =
        normalized.institutionAddress;
}

// ========================================
// ESTADO DE SINCRONIZACIÓN
// ========================================

function renderConnectionStatus() {
    if (!currentUser) {
        settingsConnectionStatus.textContent =
            "Sin conectar";

        return;
    }

    if (!isAdmin) {
        settingsConnectionStatus.textContent =
            "Acceso restringido";

        return;
    }

    if (savingSettings) {
        settingsConnectionStatus.textContent =
            "Guardando cambios...";

        return;
    }

    if (!settingsLoaded) {
        settingsConnectionStatus.textContent =
            "Conectando...";

        return;
    }

    settingsConnectionStatus.textContent =
        serverConnected
            ? "Sincronizado con Firebase"
            : "Datos locales / sin confirmar";
}

// ========================================
// DETECTAR CAMBIOS SIN GUARDAR
// ========================================

institutionFields.forEach(field => {
    field.addEventListener("input", () => {
        if (!canEditSettings()) return;

        const formData =
            readSettingsForm();

        settingsDirty =
            !sameSettings(
                formData,
                lastServerData
            );

        if (!settingsDirty) {
            remoteChanged = false;

            showSettingsMessage(
                "No hay cambios pendientes."
            );

            return;
        }

        if (remoteChanged) {
            showSettingsMessage(
                "La configuración cambió desde otra sesión. Revisa los datos antes de guardar.",
                true
            );

        } else {
            showSettingsMessage(
                "Tienes cambios sin guardar."
            );
        }
    });
});

// ========================================
// VALIDAR DATOS
// ========================================

function validateSettings(data) {
    if (!data.institutionName) {
        return "Debes ingresar el nombre de la institución.";
    }

    if (data.institutionName.length > 200) {
        return "El nombre no puede superar los 200 caracteres.";
    }

    if (
        data.institutionEmail &&
        !validEmail(data.institutionEmail)
    ) {
        return "Ingresa un correo institucional válido.";
    }

    if (data.institutionPhone.length > 50) {
        return "El teléfono no puede superar los 50 caracteres.";
    }

    if (
        data.institutionPhone &&
        !/^[0-9+().\s-]+$/.test(
            data.institutionPhone
        )
    ) {
        return "Ingresa un número de teléfono válido.";
    }

    if (data.institutionAddress.length > 500) {
        return "La dirección no puede superar los 500 caracteres.";
    }

    return "";
}

// ========================================
// GUARDAR CONFIGURACIÓN
// ========================================

settingsForm.addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        if (!hasAdminAccess()) {
            showSettingsMessage(
                "No tienes permisos para modificar la configuración.",
                true
            );

            return;
        }

        if (!canSaveSettings()) {
            showSettingsMessage(
                "Espera a que Firebase confirme la sincronización.",
                true
            );

            return;
        }

        const data =
            readSettingsForm();

        const validationError =
            validateSettings(data);

        if (validationError) {
            showSettingsMessage(
                validationError,
                true
            );

            return;
        }

        if (
            remoteChanged &&
            !confirm(
                "Otra sesión modificó la configuración. ¿Deseas guardar tus datos y reemplazar los valores actuales?"
            )
        ) {
            return;
        }

        const revision =
            sessionRevision;

        const adminEmail =
            currentUser.email || "";

        savingSettings = true;

        updateFormAccess();
        renderConnectionStatus();

        showSettingsMessage(
            "Guardando configuración..."
        );

        try {
            await setDoc(
                settingsRef,
                {
                    ...data,

                    updatedAt:
                        serverTimestamp(),

                    updatedBy:
                        adminEmail
                },
                {
                    merge: true
                }
            );

            if (!validSession(revision)) {
                return;
            }

            settingsDirty = false;
            remoteChanged = false;

            lastServerData =
                normalizeSettings(data);

            renderSettings(data);

            showSettingsMessage(
                "Configuración guardada correctamente en Firebase."
            );

        } catch (error) {
            console.error(
                "Error al guardar configuración:",
                error
            );

            if (!validSession(revision)) {
                return;
            }

            showSettingsMessage(
                "No se pudo guardar: " +
                error.message,
                true
            );

        } finally {
            if (validSession(revision)) {
                savingSettings = false;

                updateFormAccess();

                renderConnectionStatus();
            }
        }
    }
);

// ========================================
// DETENER CONSULTA ANTERIOR
// ========================================

function stopSettingsListener() {
    if (unsubscribeSettings) {
        unsubscribeSettings();
        unsubscribeSettings = null;
    }
}

// ========================================
// REINICIAR MÓDULO
// ========================================

function resetModule() {
    settingsLoaded = false;
    serverConnected = false;
    savingSettings = false;
    settingsDirty = false;
    remoteChanged = false;

    lastServerData = null;

    clearSettings();
    renderAccount();
    updateFormAccess();
    renderConnectionStatus();

    showSettingsMessage("");
}

// ========================================
// ESCUCHAR CONFIGURACIÓN DE FIREBASE
// ========================================

function startSettingsListener(revision) {
    unsubscribeSettings = onSnapshot(
        settingsRef,

        {
            includeMetadataChanges: true
        },

        snapshot => {
            if (!validSession(revision)) {
                return;
            }

            const fromCache =
                snapshot.metadata.fromCache;

            const hasPendingWrites =
                snapshot.metadata.hasPendingWrites;

            serverConnected =
                !fromCache &&
                !hasPendingWrites;

            renderConnectionStatus();

            // No reemplazar el formulario con
            // escrituras locales pendientes.
            if (hasPendingWrites) {
                updateFormAccess();
                return;
            }

            const data = normalizeSettings(
                snapshot.exists()
                    ? snapshot.data()
                    : {}
            );

            // Esperar una lectura confirmada
            // antes de habilitar la configuración.
            if (fromCache && !settingsLoaded) {
                showSettingsMessage(
                    "Esperando confirmación de Firebase..."
                );

                updateFormAccess();

                return;
            }

            if (!fromCache) {
                const firstLoad =
                    !settingsLoaded;

                const changed =
                    lastServerData !== null &&
                    !sameSettings(
                        data,
                        lastServerData
                    );

                settingsLoaded = true;

                lastServerData = data;

                // Durante un guardado no
                // modificar el formulario.
                if (savingSettings) {
                    updateFormAccess();
                    renderConnectionStatus();
                    return;
                }

                if (!settingsDirty || firstLoad) {
                    renderSettings(data);
                    remoteChanged = false;

                } else if (
                    sameSettings(
                        readSettingsForm(),
                        data
                    )
                ) {
                    settingsDirty = false;
                    remoteChanged = false;

                } else if (changed) {
                    remoteChanged = true;
                }

                if (remoteChanged) {
                    showSettingsMessage(
                        "La configuración fue actualizada desde otra sesión. Tus cambios locales se conservaron.",
                        true
                    );

                } else if (settingsDirty) {
                    showSettingsMessage(
                        "Tienes cambios sin guardar."
                    );

                } else {
                    showSettingsMessage(
                        snapshot.exists()
                            ? "Configuración sincronizada con Firebase."
                            : "Completa los datos para configurar la institución."
                    );
                }

            } else {
                showSettingsMessage(
                    "No se ha confirmado la conexión con Firebase. Conservamos los datos actuales.",
                    true
                );
            }

            updateFormAccess();
            renderConnectionStatus();
        },

        error => {
            if (!validSession(revision)) {
                return;
            }

            console.error(
                "Error al cargar configuración:",
                error
            );

            settingsLoaded = false;
            serverConnected = false;
            settingsDirty = false;
            remoteChanged = false;

            lastServerData = null;

            clearSettings();

            updateFormAccess();

            settingsConnectionStatus.textContent =
                "Error de sincronización";

            showSettingsMessage(
                "No se pudo cargar la configuración: " +
                error.message,
                true
            );
        }
    );
}

// ========================================
// CAMBIOS DE USUARIO Y ROL
// ========================================

window.addEventListener(
    "firebase-role-changed",

    event => {
        const revision =
            ++sessionRevision;

        stopSettingsListener();

        currentUser =
            event.detail?.user ?? null;

        isAdmin =
            event.detail?.isAdmin === true;

        resetModule();

        if (!currentUser) {
            showSettingsMessage(
                "Conecta tu cuenta Google para consultar la configuración."
            );

            return;
        }

        if (!hasAdminAccess()) {
            settingsConnectionStatus.textContent =
                "Acceso restringido";

            showSettingsMessage(
                "Solo la administradora puede consultar y modificar la configuración.",
                true
            );

            return;
        }

        showSettingsMessage(
            "Cargando configuración institucional..."
        );

        startSettingsListener(revision);
    }
);

// ========================================
// ESTADO INICIAL
// ========================================

resetModule();

showSettingsMessage(
    "Conecta una cuenta administradora."
);
