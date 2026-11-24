
import { db, auth } from "./firebase.js";

import {
    collection,
    addDoc,
    updateDoc,
    doc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ========================================
// ELEMENTOS HTML
// ========================================

const $ = id => document.getElementById(id);

const teacherForm = $("teacherForm");
const teacherId = $("teacherId");
const teacherName = $("teacherName");
const teacherEmail = $("teacherEmail");
const teacherStatus = $("teacherStatus");
const teacherMessage = $("teacherMessage");

const saveTeacherButton = $("saveTeacherButton");
const cancelTeacherButton = $("cancelTeacherButton");

const teacherSearch = $("teacherSearch");
const teacherTable = $("teacherTable");

const teacherTotal = $("teacherTotal");
const teacherActive = $("teacherActive");
const teacherInactive = $("teacherInactive");

const teacherHistorySelect = $("teacherHistorySelect");
const teacherHistoryTable = $("teacherHistoryTable");


// ========================================
// ESTADO DEL MÓDULO
// ========================================

let teachers = [];
let requests = [];

let isAdmin = false;
let currentUser = null;
let sessionRevision = 0;

let savingTeacher = false;

let teachersLoaded = false;
let requestsLoaded = false;

let teachersError = false;
let requestsError = false;

let unsubscribeTeachers = null;
let unsubscribeRequests = null;

const validStatuses = [
    "Activo",
    "Inactivo"
];


// ========================================
// UTILIDADES
// ========================================

const clean = value =>
    String(value ?? "").trim();

const normalizeEmail = value =>
    clean(value).toLowerCase();

const normalize = value =>
    clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

function validEmail(email) {

    return (
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        email.length <= 254
    );

}

function validQuantity(value) {

    return (
        Number.isSafeInteger(value) &&
        value >= 0
    );

}

function safeQuantity(value) {

    return validQuantity(value)
        ? value
        : 0;

}


// ========================================
// CONTROL DE PERMISOS
// ========================================

function hasAdminAccess() {

    return (
        currentUser !== null &&
        isAdmin === true &&
        auth.currentUser?.uid === currentUser.uid
    );

}

function validSession(revision) {

    return (
        revision === sessionRevision &&
        hasAdminAccess()
    );

}

function canOperate() {

    return (
        hasAdminAccess() &&
        teachersLoaded &&
        requestsLoaded &&
        !teachersError &&
        !requestsError &&
        !savingTeacher
    );

}


// ========================================
// CONTROL DE FORMULARIOS
// ========================================

function updateFormAccess() {

    const enabled = canOperate();

    teacherForm
        .querySelectorAll(
            "input, select, textarea, button"
        )
        .forEach(element => {

            element.disabled = !enabled;

        });

    teacherSearch.disabled =
        !hasAdminAccess() ||
        !teachersLoaded;

    teacherHistorySelect.disabled =
        !hasAdminAccess() ||
        !teachersLoaded ||
        !requestsLoaded;

    teacherTable
        .querySelectorAll("button")
        .forEach(button => {

            button.disabled = !enabled;

        });

}


// ========================================
// MENSAJES
// ========================================

function showMessage(message, error = false) {

    teacherMessage.textContent = message;

    teacherMessage.style.color =
        error
            ? "#B42318"
            : "#244D38";

}

function emptyRow(columns, message) {

    const row =
        document.createElement("tr");

    const cell =
        document.createElement("td");

    cell.colSpan = columns;

    cell.className = "empty-message";

    cell.textContent = message;

    row.appendChild(cell);

    return row;

}

function addCell(row, value) {

    const cell =
        document.createElement("td");

    cell.textContent =
        String(value ?? "—");

    row.appendChild(cell);

    return cell;

}


// ========================================
// LIMPIAR FORMULARIO
// ========================================

function resetForm() {

    teacherForm.reset();

    teacherId.value = "";

    teacherStatus.value = "Activo";

    saveTeacherButton.textContent =
        "Guardar docente";

}


// ========================================
// FORMATO DE FECHAS
// ========================================

function getDate(value) {

    if (!value) return null;

    try {

        const date =
            typeof value.toDate === "function"
                ? value.toDate()
                : new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;

    } catch {

        return null;

    }

}

function formatDate(value) {

    const date = getDate(value);

    if (!date) return "Sin fecha";

    return date.toLocaleDateString(
        "es-CR",
        {
            timeZone: "America/Costa_Rica",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    );

}


// ========================================
// ESTADÍSTICAS DE DOCENTES
// ========================================

function renderSummary() {

    if (!hasAdminAccess()) {

        teacherTotal.textContent = "0";
        teacherActive.textContent = "0";
        teacherInactive.textContent = "0";

        return;

    }

    if (!teachersLoaded || teachersError) {

        teacherTotal.textContent = "—";
        teacherActive.textContent = "—";
        teacherInactive.textContent = "—";

        return;

    }

    teacherTotal.textContent =
        teachers.length;

    teacherActive.textContent =
        teachers.filter(
            teacher => teacher.status === "Activo"
        ).length;

    teacherInactive.textContent =
        teachers.filter(
            teacher => teacher.status === "Inactivo"
        ).length;

}


// ========================================
// OBTENER SOLICITUDES DE UN DOCENTE
// ========================================

function getTeacherRequests(teacher) {

    const email =
        normalizeEmail(teacher.email);

    if (!email) return [];

    return requests.filter(request =>

        normalizeEmail(request.teacherEmail) === email

    );

}


// ========================================
// AGRUPAR PEDIDOS DE UN DOCENTE
// ========================================

function getTeacherOrders(teacher) {

    const teacherRequests =
        getTeacherRequests(teacher);

    const groups = new Map();

    teacherRequests.forEach(request => {

        const hasOrderId =
            typeof request.orderId === "string" &&
            request.orderId.length > 0;

        const orderId =
            hasOrderId
                ? request.orderId
                : request.id;

        const key = JSON.stringify([
            request.teacherId,
            request.unit,
            hasOrderId ? "pedido" : "anterior",
            orderId
        ]);

        if (!groups.has(key)) {

            groups.set(key, {

                id: orderId,

                unit:
                    request.unit || "—",

                createdAt:
                    request.createdAt ?? request.date,

                generalNotes:
                    request.generalNotes || "",

                items: [],

                requested: 0,

                delivered: 0,

                pending: 0,

                validData: true,

                status: "Pendiente"

            });

        }

        const order = groups.get(key);

        order.items.push(request);

        const requested =
            request.requestedQuantity;

        const delivered =
            request.deliveredQuantity;

        const pending =
            request.pendingQuantity;

        order.requested +=
            safeQuantity(requested);

        order.delivered +=
            safeQuantity(delivered);

        order.pending +=
            safeQuantity(pending);

        if (

            !validQuantity(requested) ||

            requested <= 0 ||

            !validQuantity(delivered) ||

            !validQuantity(pending) ||

            requested - delivered !== pending

        ) {

            order.validData = false;

        }

        const previousDate =
            getDate(order.createdAt);

        const currentDate =
            getDate(
                request.createdAt ?? request.date
            );

        if (

            currentDate &&

            (
                !previousDate ||
                currentDate.getTime() <
                    previousDate.getTime()
            )

        ) {

            order.createdAt =
                request.createdAt ?? request.date;

        }

    });

    const orders =
        Array.from(groups.values());

    orders.forEach(order => {

        if (!order.validData) {

            order.status = "Revisar";

        } else if (

            order.items.every(item =>

                item.pendingQuantity === 0 &&
                item.status === "Entregada"

            )

        ) {

            order.status = "Entregada";

        } else if (order.delivered > 0) {

            order.status = "Parcial";

        } else {

            order.status = "Pendiente";

        }

        order.items.sort((a, b) =>

            clean(a.productName).localeCompare(
                clean(b.productName),
                "es"
            )

        );

    });

    return orders.sort((a, b) => {

        const dateA =
            getDate(a.createdAt)?.getTime() ?? 0;

        const dateB =
            getDate(b.createdAt)?.getTime() ?? 0;

        return dateB - dateA;

    });

}


// ========================================
// TABLA DE DOCENTES
// ========================================

function renderTeachers() {

    teacherTable.replaceChildren();

    if (!hasAdminAccess()) {

        teacherTable.appendChild(
            emptyRow(
                5,
                "Solo administración puede consultar los docentes."
            )
        );

        return;

    }

    if (teachersError) {

        teacherTable.appendChild(
            emptyRow(
                5,
                "No se pudieron cargar los docentes."
            )
        );

        return;

    }

    if (!teachersLoaded) {

        teacherTable.appendChild(
            emptyRow(
                5,
                "Cargando docentes..."
            )
        );

        return;

    }

    const search =
        normalize(teacherSearch.value);

    const filtered = teachers.filter(teacher =>

        normalize(teacher.name).includes(search) ||

        normalize(teacher.email).includes(search)

    );

    if (!filtered.length) {

        teacherTable.appendChild(
            emptyRow(
                5,
                "No se encontraron docentes."
            )
        );

        return;

    }

    filtered.forEach(teacher => {

        const row =
            document.createElement("tr");

        addCell(
            row,
            teacher.name || "Sin nombre"
        );

        addCell(
            row,
            teacher.email || "Sin correo"
        );

        addCell(
            row,
            validStatuses.includes(teacher.status)
                ? teacher.status
                : "Sin estado válido"
        );

        // CONTAR PEDIDOS COMPLETOS
        // NO MATERIALES INDIVIDUALES

        addCell(

            row,

            requestsLoaded && !requestsError

                ? getTeacherOrders(teacher).length

                : "—"

        );

        const actions =
            document.createElement("td");

        const editButton =
            document.createElement("button");

        editButton.type = "button";

        editButton.className =
            "secondary-button";

        editButton.textContent =
            "Editar";

        editButton.disabled =
            !canOperate();

        editButton.addEventListener(
            "click",
            () => {

                if (!canOperate()) return;

                const latestTeacher =
                    teachers.find(
                        item => item.id === teacher.id
                    );

                if (!latestTeacher) {

                    showMessage(
                        "El docente ya no está disponible.",
                        true
                    );

                    return;

                }

                teacherId.value =
                    latestTeacher.id;

                teacherName.value =
                    latestTeacher.name || "";

                teacherEmail.value =
                    latestTeacher.email || "";

                teacherStatus.value =
                    validStatuses.includes(
                        latestTeacher.status
                    )
                        ? latestTeacher.status
                        : "Activo";

                saveTeacherButton.textContent =
                    "Actualizar docente";

                showMessage("");

                teacherForm.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });

            }
        );

        actions.appendChild(editButton);

        row.appendChild(actions);

        teacherTable.appendChild(row);

    });

}


// ========================================
// SELECTOR DE DOCENTES
// ========================================

function renderTeacherOptions() {

    const selected =
        teacherHistorySelect.value;

    teacherHistorySelect.replaceChildren();

    teacherHistorySelect.add(
        new Option(
            "Seleccionar docente",
            ""
        )
    );

    if (

        hasAdminAccess() &&

        teachersLoaded &&

        !teachersError

    ) {

        teachers.forEach(teacher => {

            teacherHistorySelect.add(

                new Option(

                    `${teacher.name || "Docente"} (${teacher.email || "Sin correo"})`,

                    teacher.id

                )

            );

        });

        if (

            teachers.some(
                teacher => teacher.id === selected
            )

        ) {

            teacherHistorySelect.value =
                selected;

        }

    }

    renderHistory();

}


// ========================================
// INDICADORES DE ESTADO
// ========================================

function createStatusBadge(status) {

    const badge =
        document.createElement("span");

    const styles = {

        Pendiente: {
            background: "#FFF0D7",
            color: "#92500E"
        },

        Parcial: {
            background: "#EEE5DB",
            color: "#654A35"
        },

        Entregada: {
            background: "#DFEBDD",
            color: "#244D38"
        },

        Revisar: {
            background: "#FCE8E6",
            color: "#B42318"
        }

    };

    const selectedStyle =
        Object.hasOwn(styles, status)
            ? styles[status]
            : styles.Revisar;

    badge.textContent =
        Object.hasOwn(styles, status)
            ? status
            : "Revisar";

    Object.assign(badge.style, {

        display: "inline-block",

        background: selectedStyle.background,

        color: selectedStyle.color,

        borderRadius: "20px",

        padding: "6px 12px",

        fontSize: "12px",

        fontWeight: "600",

        whiteSpace: "nowrap"

    });

    return badge;

}


// ========================================
// RESUMEN DEL HISTORIAL
// ========================================

function renderHistorySummary(orders) {

    const row =
        document.createElement("tr");

    const cell =
        document.createElement("td");

    cell.colSpan = 7;

    cell.style.padding = "20px";

    cell.style.background = "#F7F5EF";

    const completed = orders.filter(

        order => order.status === "Entregada"

    ).length;

    const pending =
        orders.length - completed;

    const container =
        document.createElement("div");

    Object.assign(container.style, {

        display: "grid",

        gridTemplateColumns:
            "repeat(auto-fit, minmax(120px, 1fr))",

        gap: "12px"

    });

    const indicators = [

        {
            label: "Pedidos totales",
            value: orders.length,
            color: "#244D38"
        },

        {
            label: "Pedidos pendientes",
            value: pending,
            color: "#92500E"
        },

        {
            label: "Pedidos completados",
            value: completed,
            color: "#557544"
        }

    ];

    indicators.forEach(indicator => {

        const card =
            document.createElement("div");

        Object.assign(card.style, {

            background: "#FFFFFF",

            border: "1px solid #D4BFA7",

            borderRadius: "10px",

            padding: "14px"

        });

        const title =
            document.createElement("div");

        title.textContent =
            indicator.label;

        Object.assign(title.style, {

            color: "#654A35",

            fontSize: "13px",

            marginBottom: "8px"

        });

        const value =
            document.createElement("strong");

        value.textContent =
            String(indicator.value);

        Object.assign(value.style, {

            color: indicator.color,

            fontSize: "26px"

        });

        card.appendChild(title);
        card.appendChild(value);

        container.appendChild(card);

    });

    cell.appendChild(container);

    row.appendChild(cell);

    teacherHistoryTable.appendChild(row);

}


// ========================================
// ENCABEZADO DE CADA PEDIDO
// ========================================

function renderOrderHeader(order) {

    const row =
        document.createElement("tr");

    const cell =
        document.createElement("td");

    cell.colSpan = 7;

    Object.assign(cell.style, {

        background: "#E8EFE3",

        color: "#244D38",

        borderTop: "2px solid #557544",

        padding: "16px",

        whiteSpace: "normal"

    });

    const container =
        document.createElement("div");

    Object.assign(container.style, {

        display: "flex",

        flexWrap: "wrap",

        alignItems: "center",

        gap: "12px"

    });

    const title =
        document.createElement("strong");

    title.textContent =
        `Pedido ${order.id}`;

    title.style.overflowWrap =
        "anywhere";

    container.appendChild(title);

    container.appendChild(
        createStatusBadge(order.status)
    );

    cell.appendChild(container);

    const description =
        document.createElement("p");

    description.textContent =

        `${formatDate(order.createdAt)} · ` +

        `${order.unit} · ` +

        `${order.items.length} materiales`;

    Object.assign(description.style, {

        margin: "8px 0",

        fontSize: "13px",

        color: "#426047"

    });

    cell.appendChild(description);

    const totals =
        document.createElement("p");

    totals.textContent = order.validData

        ? (
            `Solicitadas: ${order.requested} · ` +
            `Entregadas: ${order.delivered} · ` +
            `Pendientes: ${order.pending}`
        )

        : "Las cantidades de este pedido requieren revisión.";

    Object.assign(totals.style, {

        fontSize: "13px",

        fontWeight: "600",

        margin: "8px 0"

    });

    cell.appendChild(totals);

    if (order.generalNotes) {

        const notes =
            document.createElement("p");

        notes.textContent =

            "Observaciones generales: " +

            order.generalNotes;

        Object.assign(notes.style, {

            marginTop: "8px",

            fontSize: "13px",

            whiteSpace: "pre-wrap",

            overflowWrap: "anywhere"

        });

        cell.appendChild(notes);

    }

    row.appendChild(cell);

    teacherHistoryTable.appendChild(row);

}


// ========================================
// HISTORIAL DE PEDIDOS
// ========================================

function renderHistory() {

    teacherHistoryTable.replaceChildren();

    if (!hasAdminAccess()) {

        teacherHistoryTable.appendChild(
            emptyRow(
                7,
                "No tienes permisos para consultar este historial."
            )
        );

        return;

    }

    if (requestsError || teachersError) {

        teacherHistoryTable.appendChild(
            emptyRow(
                7,
                "No fue posible cargar el historial."
            )
        );

        return;

    }

    if (!requestsLoaded || !teachersLoaded) {

        teacherHistoryTable.appendChild(
            emptyRow(
                7,
                "Cargando historial de pedidos..."
            )
        );

        return;

    }

    const teacher = teachers.find(

        item => item.id === teacherHistorySelect.value

    );

    if (!teacher) {

        teacherHistoryTable.appendChild(
            emptyRow(
                7,
                "Selecciona un docente para consultar su historial."
            )
        );

        return;

    }

    const orders =
        getTeacherOrders(teacher);

    renderHistorySummary(orders);

    if (!orders.length) {

        teacherHistoryTable.appendChild(
            emptyRow(
                7,
                "Este docente no tiene pedidos registrados."
            )
        );

        return;

    }

    orders.forEach(order => {

        // ENCABEZADO DEL PEDIDO

        renderOrderHeader(order);

        // DETALLE DE MATERIALES

        order.items.forEach(request => {

            const row =
                document.createElement("tr");

            addCell(
                row,
                formatDate(
                    request.createdAt ?? request.date
                )
            );

            addCell(
                row,
                request.unit ?? "—"
            );

            const productCell = addCell(

                row,

                request.productName ??
                request.material ??
                "—"

            );

            if (request.notes) {

                const notes =
                    document.createElement("small");

                notes.textContent =
                    request.notes;

                Object.assign(notes.style, {

                    display: "block",

                    marginTop: "6px",

                    fontSize: "12px",

                    color: "#827769",

                    whiteSpace: "pre-wrap",

                    overflowWrap: "anywhere",

                    maxWidth: "250px"

                });

                productCell.appendChild(notes);

            }

            addCell(
                row,
                validQuantity(request.requestedQuantity)
                    ? request.requestedQuantity
                    : "—"
            );

            addCell(
                row,
                validQuantity(request.deliveredQuantity)
                    ? request.deliveredQuantity
                    : "—"
            );

            addCell(
                row,
                validQuantity(request.pendingQuantity)
                    ? request.pendingQuantity
                    : "—"
            );

            const statusCell =
                document.createElement("td");

            statusCell.appendChild(
                createStatusBadge(
                    request.status || "Pendiente"
                )
            );

            row.appendChild(statusCell);

            teacherHistoryTable.appendChild(row);

        });

    });

}


// ========================================
// ACTUALIZAR INTERFAZ
// ========================================

function renderAll() {

    renderSummary();

    renderTeachers();

    renderTeacherOptions();

    updateFormAccess();

}


// ========================================
// BUSCADOR E HISTORIAL
// ========================================

teacherSearch.addEventListener(
    "input",
    renderTeachers
);

teacherHistorySelect.addEventListener(
    "change",
    renderHistory
);


// ========================================
// CANCELAR EDICIÓN
// ========================================

cancelTeacherButton.addEventListener(
    "click",
    () => {

        if (!canOperate()) return;

        resetForm();

        showMessage("Formulario limpio.");

    }
);


// ========================================
// REGISTRAR O ACTUALIZAR DOCENTE
// ========================================

teacherForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        if (!canOperate()) {

            showMessage(
                "No puedes guardar docentes en este momento.",
                true
            );

            return;

        }

        const revision =
            sessionRevision;

        const adminEmail =
            currentUser.email || "";

        const name =
            clean(teacherName.value);

        const email =
            normalizeEmail(teacherEmail.value);

        const status =
            teacherStatus.value;

        const id =
            clean(teacherId.value);

        // VALIDAR NOMBRE

        if (!name || name.length > 150) {

            showMessage(
                "Ingresa un nombre válido de máximo 150 caracteres.",
                true
            );

            return;

        }

        // VALIDAR CORREO

        if (!validEmail(email)) {

            showMessage(
                "Ingresa un correo electrónico válido.",
                true
            );

            return;

        }

        // VALIDAR ESTADO

        if (!validStatuses.includes(status)) {

            showMessage(
                "Selecciona un estado válido.",
                true
            );

            return;

        }

        // COMPROBAR DUPLICADOS

        const duplicate = teachers.some(

            teacher =>

                normalizeEmail(teacher.email) === email &&

                teacher.id !== id

        );

        if (duplicate) {

            showMessage(
                "Ya existe un docente con ese correo electrónico.",
                true
            );

            return;

        }

        // VALIDAR EDICIÓN

        if (id) {

            const existingTeacher = teachers.find(

                teacher => teacher.id === id

            );

            if (!existingTeacher) {

                showMessage(
                    "El docente ya no existe.",
                    true
                );

                return;

            }

            const previousEmail =
                normalizeEmail(existingTeacher.email);

            // PROTEGER HISTORIAL DE PEDIDOS

            if (

                previousEmail !== email &&

                getTeacherRequests(existingTeacher).length > 0

            ) {

                showMessage(

                    "No se puede cambiar el correo de un docente que tiene pedidos registrados. Puedes registrarlo con su nuevo correo y conservar el registro anterior.",

                    true

                );

                return;

            }

        }

        // EVITAR ENVÍOS DUPLICADOS

        savingTeacher = true;

        updateFormAccess();

        saveTeacherButton.textContent =
            "Guardando...";

        showMessage("Guardando docente...");

        try {

            if (!validSession(revision)) {

                throw new Error(
                    "La sesión administrativa cambió."
                );

            }

            const data = {

                name,

                email,

                status,

                updatedAt:
                    serverTimestamp(),

                updatedBy:
                    adminEmail

            };

            if (id) {

                await updateDoc(

                    doc(db, "docentes", id),

                    data

                );

            } else {

                await addDoc(

                    collection(db, "docentes"),

                    {

                        ...data,

                        createdAt:
                            serverTimestamp(),

                        createdBy:
                            adminEmail

                    }

                );

            }

            if (!validSession(revision)) return;

            resetForm();

            showMessage(

                id
                    ? "Docente actualizado correctamente."
                    : "Docente registrado correctamente."

            );

        } catch (error) {

            console.error(
                "Error al guardar docente:",
                error
            );

            if (!validSession(revision)) return;

            showMessage(

                "No se pudo guardar el docente: " +

                error.message,

                true

            );

        } finally {

            if (validSession(revision)) {

                savingTeacher = false;

                saveTeacherButton.textContent =

                    teacherId.value

                        ? "Actualizar docente"

                        : "Guardar docente";

                updateFormAccess();

            }

        }

    }
);


// ========================================
// DETENER CONSULTAS ANTERIORES
// ========================================

function stopListeners() {

    if (unsubscribeTeachers) {

        unsubscribeTeachers();

        unsubscribeTeachers = null;

    }

    if (unsubscribeRequests) {

        unsubscribeRequests();

        unsubscribeRequests = null;

    }

}


// ========================================
// REINICIAR MÓDULO
// ========================================

function resetModule() {

    teachers = [];
    requests = [];

    teachersLoaded = false;
    requestsLoaded = false;

    teachersError = false;
    requestsError = false;

    savingTeacher = false;

    teacherSearch.value = "";

    teacherHistorySelect.value = "";

    resetForm();

    showMessage("");

    renderAll();

}


// ========================================
// LIMPIAR SESIÓN ADMINISTRATIVA
// ========================================

function clearSession() {

    sessionRevision++;

    stopListeners();

    currentUser = null;

    isAdmin = false;

    resetModule();

    showMessage(
        "Conecta una cuenta administradora."
    );

}


// ========================================
// ESTADO DE SINCRONIZACIÓN
// ========================================

function showSyncStatus() {

    if (savingTeacher) return;

    if (teachersError || requestsError) {

        showMessage(
            "No se pudo sincronizar toda la información con Firebase.",
            true
        );

        return;

    }

    if (!teachersLoaded || !requestsLoaded) {

        showMessage(
            "Cargando información..."
        );

        return;

    }

    showMessage(
        "Docentes y pedidos sincronizados con Firebase."
    );

}


// ========================================
// CAMBIO DE USUARIO
// ========================================

window.addEventListener(
    "firebase-user-changed",
    event => {

        if (

            !event.detail ||

            (
                currentUser &&
                event.detail.uid !== currentUser.uid
            )

        ) {

            clearSession();

        }

    }
);


// ========================================
// CAMBIOS DE USUARIO Y ROL
// ========================================

window.addEventListener(
    "firebase-role-changed",
    event => {

        const revision =
            ++sessionRevision;

        stopListeners();

        currentUser =
            event.detail?.user ?? null;

        isAdmin =
            event.detail?.isAdmin === true;

        resetModule();

        if (!hasAdminAccess()) {

            showMessage(
                "Solo la cuenta administradora puede gestionar docentes.",
                true
            );

            return;

        }

        showMessage(
            "Cargando docentes..."
        );


        // =================================
        // ESCUCHAR DOCENTES
        // =================================

        unsubscribeTeachers = onSnapshot(

            collection(db, "docentes"),

            {
                includeMetadataChanges: true
            },

            snapshot => {

                if (!validSession(revision)) return;

                const firstLoad =
                    !teachersLoaded;

                teachersLoaded =
                    !snapshot.metadata.fromCache &&
                    !snapshot.metadata.hasPendingWrites;

                teachers = teachersLoaded

                    ? snapshot.docs.map(item => ({

                        ...item.data(),

                        id: item.id

                    }))

                    : [];

                teachers.sort((a, b) =>

                    clean(a.name).localeCompare(

                        clean(b.name),

                        "es"

                    )

                );

                teachersError = false;

                renderAll();

                if (firstLoad || !teachersLoaded) {

                    showSyncStatus();

                }

            },

            error => {

                if (!validSession(revision)) return;

                console.error(
                    "Error al cargar docentes:",
                    error
                );

                teachers = [];

                teachersLoaded = false;

                teachersError = true;

                renderAll();

                showSyncStatus();

            }

        );


        // =================================
        // ESCUCHAR PEDIDOS
        // =================================

        unsubscribeRequests = onSnapshot(

            collection(db, "solicitudes"),

            {
                includeMetadataChanges: true
            },

            snapshot => {

                if (!validSession(revision)) return;

                const firstLoad =
                    !requestsLoaded;

                requestsLoaded =
                    !snapshot.metadata.fromCache &&
                    !snapshot.metadata.hasPendingWrites;

                requests = requestsLoaded

                    ? snapshot.docs.map(item => ({

                        ...item.data(),

                        id: item.id

                    }))

                    : [];

                requestsError = false;

                renderAll();

                if (firstLoad || !requestsLoaded) {

                    showSyncStatus();

                }

            },

            error => {

                if (!validSession(revision)) return;

                console.error(
                    "Error al cargar pedidos:",
                    error
                );

                requests = [];

                requestsLoaded = false;

                requestsError = true;

                renderAll();

                showSyncStatus();

            }

        );

    }
);


// ========================================
// ESTADO INICIAL
// ========================================

clearSession();


// ========================================
// FIN DEL MÓDULO DE DOCENTES
// ========================================
