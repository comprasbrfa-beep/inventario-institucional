
import {
    auth,
    googleProvider,
    db
} from "./firebase.js";

// ==========================================
// MÓDULOS DEL SISTEMA
// ==========================================

import "./inventario.js";
import "./solicitudes.js";
import "./dashboard.js";
import "./movimientos.js";
import "./proveeduria.js";
import "./docentes.js";
import "./reportes.js";
import "./configuracion.js";
import "./importar.js";

// ==========================================
// FIREBASE
// ==========================================

import {
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    doc,
    getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==========================================
// ESTADO DEL USUARIO
// ==========================================

let currentUser = null;
let isAdmin = false;
let authRevision = 0;

// ==========================================
// ELEMENTOS
// ==========================================

const googleButton = document.getElementById("googleButton");
const logoutButton = document.getElementById("logoutButton");

const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userAvatar = document.getElementById("userAvatar");

const connectionText = document.getElementById("connectionText");
const connectionIndicator = document.getElementById("connectionIndicator");

const pageTitle = document.getElementById("pageTitle");

// ==========================================
// NAVEGACIÓN
// ==========================================

const navigationLinks = document.querySelectorAll(".nav-link");
const quickButtons = document.querySelectorAll(".quick-button");
const pages = document.querySelectorAll(".page");

// ==========================================
// TÍTULOS
// ==========================================

const pageTitles = {
    dashboard: "Dashboard",
    inventario: "Inventario general",
    movimientos: "Movimientos",
    solicitudes: "Solicitudes docentes",
    proveeduria: "Proveeduría",
    docentes: "Docentes",
    reportes: "Reportes",
    configuracion: "Configuración"
};

// ==========================================
// VERIFICAR USUARIO EN FIREBASE
// ==========================================

async function verifyUser(user) {

    if (!user || !user.email || !user.emailVerified) {
        return null;
    }

    const userRef = doc(
        db,
        "usuarios",
        user.email
    );

    const userSnapshot = await getDocFromServer(userRef);

    if (!userSnapshot.exists()) {
        return null;
    }

    const userData = userSnapshot.data();

    if (userData.active !== true) {
        return null;
    }

    if (
        userData.role !== "admin" &&
        userData.role !== "docente"
    ) {
        return null;
    }

    return userData;
}

// ==========================================
// CONTROLAR VISIBILIDAD DE PESTAÑAS
// ==========================================

function configureNavigation() {

    navigationLinks.forEach(link => {

        const page = link.dataset.page;

        if (!currentUser) {
            link.hidden = page !== "dashboard";
        } else if (isAdmin) {
            link.hidden = false;
        } else {
            link.hidden = page !== "solicitudes";
        }

    });

    quickButtons.forEach(button => {
        button.hidden = !currentUser || !isAdmin;
    });

    if (currentUser && !isAdmin) {
        showPage("solicitudes");
    } else {
        showPage("dashboard");
    }
}

// ==========================================
// MOSTRAR PÁGINA
// ==========================================

function showPage(pageId) {

    if (!currentUser) {
        pageId = "dashboard";
    } else if (!isAdmin) {
        pageId = "solicitudes";
    }

    pages.forEach(page => {
        page.classList.remove("active");
    });

    navigationLinks.forEach(link => {
        link.classList.remove("active");
    });

    const selectedPage = document.getElementById(pageId);

    if (!selectedPage) return;

    selectedPage.classList.add("active");

    const selectedLink = document.querySelector(
        `.nav-link[data-page="${pageId}"]`
    );

    if (selectedLink) {
        selectedLink.classList.add("active");
    }

    if (pageTitle) {
        pageTitle.textContent =
            pageId === "solicitudes" && !isAdmin
                ? "Mis solicitudes"
                : pageTitles[pageId] || "Sistema institucional";
    }
}

// ==========================================
// NOTIFICAR A LOS DEMÁS MÓDULOS
// ==========================================

function notifyModules() {

    window.dispatchEvent(
        new CustomEvent("firebase-user-changed", {
            detail: currentUser
        })
    );

    window.dispatchEvent(
        new CustomEvent("firebase-role-changed", {
            detail: {
                user: currentUser,
                isAdmin
            }
        })
    );
}

// ==========================================
// MOSTRAR ESTADO SIN SESIÓN
// ==========================================

function resetSession() {

    currentUser = null;
    isAdmin = false;

    userName.textContent = "Sin conectar";
    userEmail.textContent = "Conecta tu cuenta Google";
    userAvatar.textContent = "A";

    googleButton.hidden = false;
    googleButton.disabled = false;
    googleButton.textContent = "Conectar con Google";

    logoutButton.hidden = true;

    connectionText.textContent =
        "Conecta tu cuenta Google para acceder a los datos.";

    connectionIndicator.className =
        "connection-indicator";

    notifyModules();
    configureNavigation();
}

// ==========================================
// INICIAR SESIÓN CON GOOGLE
// ==========================================

googleButton.addEventListener("click", async () => {

    googleButton.disabled = true;
    googleButton.textContent = "Conectando...";

    try {

        await signInWithPopup(auth, googleProvider);

    } catch (error) {

        console.error(
            "Error al conectar con Google:",
            error
        );

        alert(
            "No fue posible iniciar sesión: " +
            error.message
        );

        googleButton.disabled = false;
        googleButton.textContent = "Conectar con Google";

    }
});

// ==========================================
// CERRAR SESIÓN
// ==========================================

logoutButton.addEventListener("click", async () => {

    const confirmation = confirm(
        "¿Deseas cerrar tu sesión?"
    );

    if (!confirmation) return;

    try {

        await signOut(auth);

    } catch (error) {

        console.error(
            "Error al cerrar sesión:",
            error
        );

        alert("No fue posible cerrar la sesión.");

    }
});

// ==========================================
// DETECTAR USUARIO Y VERIFICAR PERMISOS
// ==========================================

onAuthStateChanged(auth, async user => {

    const revision = ++authRevision;

    resetSession();

    if (!user) return;

    googleButton.disabled = true;
    googleButton.textContent = "Verificando acceso...";

    connectionText.textContent =
        "Verificando permisos de usuario...";

    let userData;

    try {

        userData = await verifyUser(user);

    } catch (error) {

        if (revision !== authRevision) return;

        console.error(
            "Error al verificar usuario:",
            error
        );

        alert(
            "No fue posible verificar tus permisos de acceso."
        );

        try {
            await signOut(auth);
        } catch (signOutError) {
            console.error(signOutError);
        }

        resetSession();
        return;
    }

    if (
        revision !== authRevision ||
        auth.currentUser?.uid !== user.uid
    ) {
        return;
    }

    // RECHAZAR CUENTAS NO AUTORIZADAS

    if (!userData) {

        alert(
            "Acceso denegado. Tu cuenta no está autorizada " +
            "para utilizar el Sistema de Inventario Institucional."
        );

        try {
            await signOut(auth);
        } catch (error) {
            console.error(error);
        }

        resetSession();
        return;
    }

    // USUARIO AUTORIZADO

    currentUser = user;
    isAdmin = userData.role === "admin";

    userName.textContent =
        user.displayName || "Usuario";

    userEmail.textContent =
        user.email || "";

    userAvatar.textContent = (
        user.displayName || user.email || "U"
    ).charAt(0).toUpperCase();

    googleButton.hidden = true;
    googleButton.disabled = false;
    logoutButton.hidden = false;

    connectionText.textContent =
        (isAdmin ? "Administradora: " : "Docente: ") +
        (user.email || user.displayName);

    connectionIndicator.className =
        "connection-indicator connected";

    // ACTIVAR TODOS LOS MÓDULOS

    notifyModules();

    configureNavigation();

});

// ==========================================
// EVENTOS DE NAVEGACIÓN
// ==========================================

navigationLinks.forEach(link => {

    link.addEventListener("click", event => {

        event.preventDefault();
        showPage(link.dataset.page);

    });

});

quickButtons.forEach(button => {

    button.addEventListener("click", () => {

        showPage(button.dataset.page);

    });

});

// ==========================================
// ESTADO INICIAL
// ==========================================

resetSession();
