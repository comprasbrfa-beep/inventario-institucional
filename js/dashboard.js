
import { db, auth } from "./firebase.js";

import {
    collection,
    onSnapshot,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// =====================================
// ELEMENTOS DEL DASHBOARD
// =====================================

const dashboardProducts =
    document.getElementById("dashboardProducts");

const dashboardAvailable =
    document.getElementById("dashboardAvailable");

const dashboardLowStock =
    document.getElementById("dashboardLowStock");

const dashboardRequests =
    document.getElementById("dashboardRequests");

const dashboardPendingRequests =
    document.getElementById("dashboardPendingRequests");

const dashboardDeliveredRequests =
    document.getElementById("dashboardDeliveredRequests");

const dashboardActivityTable =
    document.getElementById("dashboardActivityTable");


// =====================================
// COLECCIONES
// =====================================

const productsCollection =
    collection(db, "productos");

const requestsCollection =
    collection(db, "solicitudes");

const movementsCollection =
    collection(db, "movimientos");


// =====================================
// ESTADO DEL MÓDULO
// =====================================

let currentUser = null;
let isAdmin = false;
let sessionRevision = 0;

let products = [];
let requests = [];
let movements = [];

let productsLoaded = false;
let requestsLoaded = false;
let movementsLoaded = false;

let requestsError = false;
let movementsError = false;

let unsubscribeProducts = null;
let unsubscribeRequests = null;
let unsubscribeMovements = null;


// =====================================
// COMPROBAR PERMISOS
// =====================================

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


// =====================================
// MENSAJE DE ACTIVIDAD
// =====================================

function showActivityMessage(message) {

    if (!dashboardActivityTable) return;

    dashboardActivityTable.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;

    cell.className = "empty-message";

    cell.textContent = message;

    row.appendChild(cell);

    dashboardActivityTable.appendChild(row);

}


// =====================================
// ACTUALIZAR INDICADOR
// =====================================

function setIndicator(element, value) {

    if (element) {

        element.textContent = String(value);

    }

}


// =====================================
// VALIDAR CANTIDADES
// =====================================

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


// =====================================
// ESTADÍSTICAS DEL INVENTARIO
// =====================================

function updateProductStatistics() {

    if (!hasAdminAccess() || !productsLoaded) {

        setIndicator(dashboardProducts, "—");

        setIndicator(dashboardAvailable, "—");

        setIndicator(dashboardLowStock, "—");

        return;

    }

    const total = products.length;

    const available = products.filter(product => {

        return (
            validQuantity(product.quantity) &&
            product.quantity > 0
        );

    }).length;

    const lowStock = products.filter(product => {

        const quantity = product.quantity;

        return (
            validQuantity(quantity) &&
            quantity > 0 &&
            quantity <= 10
        );

    }).length;

    setIndicator(dashboardProducts, total);

    setIndicator(dashboardAvailable, available);

    setIndicator(dashboardLowStock, lowStock);

}


// =====================================
// CONVERTIR FECHA DE FIREBASE
// =====================================

function getTimestampDate(timestamp) {

    if (
        !timestamp ||
        typeof timestamp.toDate !== "function"
    ) {

        return null;

    }

    const date = timestamp.toDate();

    if (Number.isNaN(date.getTime())) {

        return null;

    }

    return date;

}


// =====================================
// FORMATO DE FECHA Y HORA
// =====================================

function formatActivityDate(timestamp) {

    const date = getTimestampDate(timestamp);

    if (!date) return "—";

    return date.toLocaleString("es-CR", {

        timeZone: "America/Costa_Rica",

        day: "2-digit",

        month: "2-digit",

        year: "numeric",

        hour: "2-digit",

        minute: "2-digit"

    });

}


// =====================================
// AGRUPAR SOLICITUDES POR PEDIDO
// =====================================

function groupOrders() {

    const groups = new Map();

    requests.forEach(request => {

        // COMPATIBILIDAD CON SOLICITUDES
        // REGISTRADAS ANTES DE LA ACTUALIZACIÓN

        const hasOrderId =

            typeof request.orderId === "string" &&

            request.orderId.length > 0;

        const orderId = hasOrderId

            ? request.orderId

            : request.id;

        // EVITAR AGRUPAR PEDIDOS DE
        // DOCENTES O UNIDADES DIFERENTES

        const key = JSON.stringify([

            request.teacherId,

            request.unit,

            hasOrderId ? "pedido" : "anterior",

            orderId

        ]);

        if (!groups.has(key)) {

            groups.set(key, {

                id: orderId,

                teacherName:

                    request.teacherName ||

                    request.teacherEmail ||

                    "—",

                teacherEmail:

                    request.teacherEmail || "",

                unit:

                    request.unit || "—",

                createdAt:

                    request.createdAt,

                materials: [],

                totalRequested: 0,

                totalDelivered: 0,

                totalPending: 0,

                validData: true,

                status: "Pendiente"

            });

        }

        const order = groups.get(key);

        // CONSERVAR CADA MATERIAL

        order.materials.push(request);

        // SUMAR CANTIDADES

        order.totalRequested +=

            safeQuantity(request.requestedQuantity);

        order.totalDelivered +=

            safeQuantity(request.deliveredQuantity);

        order.totalPending +=

            safeQuantity(request.pendingQuantity);

        // COMPROBAR CONSISTENCIA

        const requested =
            request.requestedQuantity;

        const delivered =
            request.deliveredQuantity;

        const pending =
            request.pendingQuantity;

        if (

            !validQuantity(requested) ||

            requested <= 0 ||

            !validQuantity(delivered) ||

            !validQuantity(pending) ||

            delivered > requested ||

            requested - delivered !== pending

        ) {

            order.validData = false;

        }

        // CONSERVAR LA FECHA INICIAL DEL PEDIDO

        const previousDate =
            getTimestampDate(order.createdAt);

        const currentDate =
            getTimestampDate(request.createdAt);

        if (

            currentDate &&

            (

                !previousDate ||

                currentDate.getTime() <
                    previousDate.getTime()

            )

        ) {

            order.createdAt =
                request.createdAt;

        }

    });

    const orders = Array.from(groups.values());

    // CALCULAR ESTADO GENERAL DE CADA PEDIDO

    orders.forEach(order => {

        if (!order.validData) {

            order.status = "Revisar";

            return;

        }

        const allDelivered = order.materials.every(

            material =>

                material.pendingQuantity === 0 &&

                material.status === "Entregada"

        );

        if (allDelivered) {

            order.status = "Entregada";

        } else if (order.totalDelivered > 0) {

            order.status = "Parcial";

        } else {

            order.status = "Pendiente";

        }

    });

    return orders;

}


// =====================================
// ESTADÍSTICAS DE PEDIDOS
// =====================================

function updateRequestStatistics() {

    if (

        !hasAdminAccess() ||

        !requestsLoaded ||

        requestsError

    ) {

        setIndicator(dashboardRequests, "—");

        setIndicator(dashboardPendingRequests, "—");

        setIndicator(dashboardDeliveredRequests, "—");

        return;

    }

    const orders = groupOrders();

    // TOTAL DE PEDIDOS, NO DE MATERIALES

    const total = orders.length;

    // PEDIDOS QUE TODAVÍA REQUIEREN ATENCIÓN

    const pending = orders.filter(order =>

        order.status !== "Entregada"

    ).length;

    // PEDIDOS COMPLETAMENTE ENTREGADOS

    const delivered = orders.filter(order =>

        order.status === "Entregada"

    ).length;

    setIndicator(dashboardRequests, total);

    setIndicator(dashboardPendingRequests, pending);

    setIndicator(dashboardDeliveredRequests, delivered);

}


// =====================================
// DESCRIPCIÓN DE MATERIALES DEL PEDIDO
// =====================================

function getOrderMaterialsDescription(order) {

    const names = order.materials.map(material =>

        material.productName || "Material sin nombre"

    );

    if (names.length === 0) {

        return "Sin materiales";

    }

    if (names.length === 1) {

        return names[0];

    }

    if (names.length <= 3) {

        return names.join(", ");

    }

    return (

        `${names.length} materiales: ` +

        names.slice(0, 2).join(", ") +

        ` y ${names.length - 2} más`

    );

}


// =====================================
// CONSTRUIR ACTIVIDAD RECIENTE
// =====================================

function renderRecentActivity() {

    if (!dashboardActivityTable) return;

    if (!hasAdminAccess()) return;

    if (requestsError || movementsError) {

        showActivityMessage(

            "No se pudo cargar toda la actividad reciente. Revisa los permisos y la conexión con Firebase."

        );

        return;

    }

    if (!requestsLoaded || !movementsLoaded) {

        showActivityMessage(

            "Cargando actividad reciente..."

        );

        return;

    }

    const activities = [];

    const orders = groupOrders();


    // =================================
    // PEDIDOS REGISTRADOS
    // =================================

    orders.forEach(order => {

        const date =
            getTimestampDate(order.createdAt);

        if (!date) return;

        activities.push({

            date,

            timestamp: order.createdAt,

            type: "Pedido registrado",

            teacher: order.teacherName,

            product:

                getOrderMaterialsDescription(order),

            quantity:

                order.validData

                    ? order.totalRequested

                    : "Revisar",

            orderId: order.id,

            status: order.status

        });

    });


    // =================================
    // ENTREGAS REALES REGISTRADAS
    // =================================

    movements.forEach(movement => {

        if (

            movement.type !== "Salida" ||

            !movement.requestId

        ) {

            return;

        }

        const quantity = movement.quantity;

        if (

            !Number.isSafeInteger(quantity) ||

            quantity <= 0

        ) {

            return;

        }

        const date =

            getTimestampDate(movement.createdAt);

        if (!date) return;

        activities.push({

            date,

            timestamp:

                movement.createdAt,

            type:

                "Entrega registrada",

            teacher:

                movement.teacherName ||

                movement.teacherEmail ||

                "—",

            product:

                movement.productName ||

                "—",

            quantity,

            orderId:

                movement.orderId ||

                movement.requestId

        });

    });


    // =================================
    // ORDENAR ACTIVIDADES
    // =================================

    activities.sort((a, b) =>

        b.date.getTime() -

        a.date.getTime()

    );


    // =================================
    // MOSTRAR ÚLTIMAS 8 ACTIVIDADES
    // =================================

    const recentActivities =

        activities.slice(0, 8);

    dashboardActivityTable.replaceChildren();

    if (recentActivities.length === 0) {

        showActivityMessage(

            "Todavía no hay actividad registrada."

        );

        return;

    }

    recentActivities.forEach(activity => {

        const row =

            document.createElement("tr");

        const values = [

            formatActivityDate(activity.timestamp),

            activity.type,

            activity.teacher,

            activity.product,

            activity.quantity

        ];

        values.forEach(value => {

            const cell =

                document.createElement("td");

            cell.textContent =

                String(value ?? "—");

            row.appendChild(cell);

        });

        // MOSTRAR IDENTIFICADOR DEL PEDIDO
        // AL COLOCAR EL CURSOR SOBRE LA FILA

        if (activity.orderId) {

            row.title =

                `Pedido: ${activity.orderId}`;

        }

        dashboardActivityTable.appendChild(row);

    });

}


// =====================================
// DETENER CONSULTAS ANTERIORES
// =====================================

function stopListeners() {

    if (unsubscribeProducts) {

        unsubscribeProducts();

        unsubscribeProducts = null;

    }

    if (unsubscribeRequests) {

        unsubscribeRequests();

        unsubscribeRequests = null;

    }

    if (unsubscribeMovements) {

        unsubscribeMovements();

        unsubscribeMovements = null;

    }

}


// =====================================
// REINICIAR DASHBOARD
// =====================================

function resetDashboard() {

    products = [];

    requests = [];

    movements = [];

    productsLoaded = false;

    requestsLoaded = false;

    movementsLoaded = false;

    requestsError = false;

    movementsError = false;

    updateProductStatistics();

    updateRequestStatistics();

    showActivityMessage(

        "Conecta tu cuenta para consultar la actividad."

    );

}


// =====================================
// LIMPIAR SESIÓN ADMINISTRATIVA
// =====================================

function clearDashboardSession() {

    sessionRevision++;

    stopListeners();

    currentUser = null;

    isAdmin = false;

    resetDashboard();

}


// =====================================
// DETECTAR CIERRE DE SESIÓN
// =====================================

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

            clearDashboardSession();

        }

    }

);


// =====================================
// CAMBIOS DE USUARIO Y ROL
// =====================================

window.addEventListener(

    "firebase-role-changed",

    event => {

        const revision = ++sessionRevision;

        const details = event.detail || {};

        stopListeners();

        currentUser = details.user || null;

        isAdmin = details.isAdmin === true;

        resetDashboard();


        // =================================
        // SIN SESIÓN
        // =================================

        if (!currentUser) {

            showActivityMessage(

                "Conecta tu cuenta Google para consultar el Dashboard."

            );

            return;

        }


        // =================================
        // SIN PERMISOS ADMINISTRATIVOS
        // =================================

        if (!hasAdminAccess()) {

            showActivityMessage(

                "El Dashboard general está disponible únicamente para administración."

            );

            return;

        }

        showActivityMessage(

            "Cargando actividad reciente..."

        );


        // =================================
        // ESCUCHAR INVENTARIO
        // =================================

        unsubscribeProducts = onSnapshot(

            productsCollection,

            {

                includeMetadataChanges: true

            },

            snapshot => {

                if (!validSession(revision)) {

                    return;

                }

                productsLoaded =

                    !snapshot.metadata.fromCache &&

                    !snapshot.metadata.hasPendingWrites;

                products = productsLoaded

                    ? snapshot.docs.map(document => ({

                        ...document.data(),

                        id: document.id

                    }))

                    : [];

                updateProductStatistics();

            },

            error => {

                if (!validSession(revision)) {

                    return;

                }

                console.error(

                    "Error al cargar estadísticas del inventario:",

                    error

                );

                products = [];

                productsLoaded = false;

                updateProductStatistics();

            }

        );


        // =================================
        // ESCUCHAR SOLICITUDES
        // =================================

        const requestsQuery = query(

            requestsCollection,

            orderBy("createdAt", "desc")

        );

        unsubscribeRequests = onSnapshot(

            requestsQuery,

            {

                includeMetadataChanges: true

            },

            snapshot => {

                if (!validSession(revision)) {

                    return;

                }

                requestsLoaded =

                    !snapshot.metadata.fromCache &&

                    !snapshot.metadata.hasPendingWrites;

                requestsError = false;

                requests = requestsLoaded

                    ? snapshot.docs.map(document => ({

                        ...document.data(),

                        id: document.id

                    }))

                    : [];

                updateRequestStatistics();

                renderRecentActivity();

            },

            error => {

                if (!validSession(revision)) {

                    return;

                }

                console.error(

                    "Error al cargar solicitudes:",

                    error

                );

                requests = [];

                requestsLoaded = false;

                requestsError = true;

                updateRequestStatistics();

                renderRecentActivity();

            }

        );


        // =================================
        // ESCUCHAR MOVIMIENTOS
        // =================================

        const movementsQuery = query(

            movementsCollection,

            orderBy("createdAt", "desc")

        );

        unsubscribeMovements = onSnapshot(

            movementsQuery,

            {

                includeMetadataChanges: true

            },

            snapshot => {

                if (!validSession(revision)) {

                    return;

                }

                movementsLoaded =

                    !snapshot.metadata.fromCache &&

                    !snapshot.metadata.hasPendingWrites;

                movementsError = false;

                movements = movementsLoaded

                    ? snapshot.docs.map(document => ({

                        ...document.data(),

                        id: document.id

                    }))

                    : [];

                renderRecentActivity();

            },

            error => {

                if (!validSession(revision)) {

                    return;

                }

                console.error(

                    "Error al cargar movimientos:",

                    error

                );

                movements = [];

                movementsLoaded = false;

                movementsError = true;

                renderRecentActivity();

            }

        );

    }

);


// =====================================
// ESTADO INICIAL
// =====================================

resetDashboard();


// =====================================
// FIN DEL MÓDULO DASHBOARD
// =====================================
