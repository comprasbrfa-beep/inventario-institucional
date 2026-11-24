
import { db, auth } from "./firebase.js";

import {
    collection,
    doc,
    onSnapshot,
    query,
    orderBy,
    where,
    serverTimestamp,
    runTransaction,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ==========================================
// ELEMENTOS DEL FORMULARIO
// ==========================================

const requestForm = document.getElementById("requestForm");
const requestTeacher = document.getElementById("requestTeacher");
const requestUnit = document.getElementById("requestUnit");

const requestProductSearch = document.getElementById("requestProductSearch");
const requestProduct = document.getElementById("requestProduct");
const requestAvailableStock = document.getElementById("requestAvailableStock");

const requestQuantity = document.getElementById("requestQuantity");
const requestNotes = document.getElementById("requestNotes");
const requestStockMessage = document.getElementById("requestStockMessage");

const addRequestItemButton = document.getElementById("addRequestItemButton");
const clearRequestCartButton = document.getElementById("clearRequestCartButton");

const requestCartCount = document.getElementById("requestCartCount");
const requestCartUnits = document.getElementById("requestCartUnits");
const requestCartTable = document.getElementById("requestCartTable");
const requestCartMessage = document.getElementById("requestCartMessage");

const requestGeneralNotes = document.getElementById("requestGeneralNotes");

const requestTable = document.getElementById("requestTable");
const requestMessage = document.getElementById("requestMessage");
const saveRequestButton = document.getElementById("saveRequestButton");

const requestCount = document.getElementById("requestCount");
const requestPendingCount = document.getElementById("requestPendingCount");
const requestDeliveredCount = document.getElementById("requestDeliveredCount");

const requestHistorySearch = document.getElementById("requestHistorySearch");
const requestStatusFilter = document.getElementById("requestStatusFilter");
const requestUnitFilter = document.getElementById("requestUnitFilter");


// ==========================================
// ESTADO DEL MÓDULO
// ==========================================

let currentUser = null;
let isAdmin = false;

let products = [];
let requests = [];
let cart = [];

let unsubscribeProducts = null;
let unsubscribeRequests = null;

let sessionRevision = 0;
let productsReady = false;
let requestsReady = false;
let savingOrder = false;
let delivering = false;

const MAX_ITEMS = 15;
const MAX_QUANTITY = 1000000;

const validUnits = [
    "Unidad 1",
    "Unidad 2",
    "Unidad 3",
    "Unidad 4"
];

const productsCollection = collection(db, "productos");
const requestsCollection = collection(db, "solicitudes");
const movementsCollection = collection(db, "movimientos");


// ==========================================
// FUNCIONES GENERALES
// ==========================================

function normalize(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function validSession(revision = sessionRevision) {
    return (
        revision === sessionRevision &&
        currentUser !== null &&
        auth.currentUser?.uid === currentUser.uid
    );
}

function validQuantity(value) {
    return (
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= MAX_QUANTITY
    );
}

function validStock(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function getTeacherName() {
    return (
        currentUser?.displayName ||
        currentUser?.email ||
        "Usuario"
    ).slice(0, 250);
}

function getProduct(productId) {
    return products.find(item => item.id === productId);
}

function productMatchesUnit(product, unit) {
    return (
        product &&
        validUnits.includes(unit) &&
        (
            product.unit === unit ||
            product.unit === "Institucional"
        )
    );
}

function appendCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "—");
    row.appendChild(cell);
    return cell;
}

function showTableMessage(table, message, columns) {
    table.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = columns;
    cell.className = "empty-message";
    cell.textContent = message;

    row.appendChild(cell);
    table.appendChild(row);
}


// ==========================================
// MENSAJES
// ==========================================

function setRequestMessage(message, type = "") {
    requestMessage.textContent = message;
    requestMessage.className = "form-message";

    if (type) {
        requestMessage.classList.add(type);
    }
}

function setCartMessage(message, type = "") {
    requestCartMessage.textContent = message;
    requestCartMessage.className = "field-help";

    if (type) {
        requestCartMessage.classList.add(type);
    }
}


// ==========================================
// CONTROL DE BOTONES
// ==========================================

function updateControls() {

    const connected = validSession();

    const canSelect =
        connected &&
        productsReady &&
        !savingOrder;

    const selectedUnit = requestUnit.value;

    const hasUnit =
        validUnits.includes(selectedUnit);

    const selectedProduct =
        getProduct(requestProduct.value);

    const hasProduct =
        productMatchesUnit(
            selectedProduct,
            selectedUnit
        );

    requestUnit.disabled =
        !canSelect || cart.length > 0;

    requestProductSearch.disabled =
        !canSelect || !hasUnit;

    requestProduct.disabled =
        !canSelect ||
        !hasUnit ||
        requestProduct.options.length <= 1;

    requestQuantity.disabled =
        !canSelect || !hasProduct;

    requestNotes.disabled =
        !canSelect || !hasProduct;

    requestGeneralNotes.disabled =
        !connected || savingOrder;

    addRequestItemButton.disabled =
        !canSelect || !hasProduct;

    clearRequestCartButton.disabled =
        !connected ||
        savingOrder ||
        cart.length === 0;

    const cartValid = cart.every(item => {

        const product = getProduct(item.productId);

        return (
            validQuantity(Number(item.quantity)) &&
            item.notes.length <= 5000 &&
            item.unit === selectedUnit &&
            productMatchesUnit(product, item.unit) &&
            validStock(product?.quantity)
        );

    });

    saveRequestButton.disabled =
        !connected ||
        !productsReady ||
        savingOrder ||
        cart.length === 0 ||
        cart.length > MAX_ITEMS ||
        !cartValid;

    saveRequestButton.textContent =
        savingOrder
            ? "Enviando pedido..."
            : "Enviar pedido completo";

    requestHistorySearch.disabled =
        !connected || !requestsReady;

    requestStatusFilter.disabled =
        !connected || !requestsReady;

    requestUnitFilter.disabled =
        !connected || !requestsReady;
}


// ==========================================
// LIMPIAR FORMULARIO
// ==========================================

function clearProductFields() {

    requestProductSearch.value = "";
    requestProduct.value = "";
    requestQuantity.value = "";
    requestNotes.value = "";

    requestAvailableStock.value =
        "Selecciona un material";

    requestStockMessage.textContent = "";

}

function resetOrderForm() {

    cart = [];

    requestUnit.value = "";
    requestGeneralNotes.value = "";

    clearProductFields();

    setCartMessage("");

    renderProductOptions();
    renderCart();
    updateControls();
}


// ==========================================
// BUSCAR Y MOSTRAR PRODUCTOS
// ==========================================

function renderProductOptions() {

    const previousProduct =
        requestProduct.value;

    const selectedUnit =
        requestUnit.value;

    const search =
        normalize(requestProductSearch.value);

    requestProduct.replaceChildren();

    if (!validSession()) {

        requestProduct.add(
            new Option(
                "Conecta tu cuenta Google",
                ""
            )
        );

    } else if (!productsReady) {

        requestProduct.add(
            new Option(
                "Esperando datos del inventario...",
                ""
            )
        );

    } else if (!validUnits.includes(selectedUnit)) {

        requestProduct.add(
            new Option(
                "Primero selecciona una unidad",
                ""
            )
        );

    } else {

        const filteredProducts = products.filter(product => {

            return (
                productMatchesUnit(product, selectedUnit) &&
                normalize(product.name).includes(search)
            );

        });

        requestProduct.add(
            new Option(
                filteredProducts.length
                    ? "Seleccionar material"
                    : "No se encontraron materiales",
                ""
            )
        );

        filteredProducts.forEach(product => {

            const available = validStock(product.quantity)
                ? product.quantity
                : "No disponible";

            requestProduct.add(
                new Option(
                    `${product.name} — Disponibles: ${available}`,
                    product.id
                )
            );

        });

        if (
            filteredProducts.some(product =>
                product.id === previousProduct
            )
        ) {

            requestProduct.value = previousProduct;

        }

    }

    updateAvailableStock();
    updateControls();
}


// ==========================================
// DISPONIBILIDAD DEL MATERIAL
// ==========================================

function updateAvailableStock() {

    const product = getProduct(
        requestProduct.value
    );

    if (!product) {

        requestAvailableStock.value =
            "Selecciona un material";

        requestStockMessage.textContent = "";

        return;
    }

    if (!validStock(product.quantity)) {

        requestAvailableStock.value =
            "Existencias no válidas";

        requestStockMessage.textContent =
            "Consulta con administración.";

        return;
    }

    const available = product.quantity;

    requestAvailableStock.value =
        `${available} unidades`;

    const alreadySelected = cart.find(item =>
        item.productId === product.id
    );

    const quantity =
        Number(requestQuantity.value) || 0;

    const combinedQuantity =
        (Number(alreadySelected?.quantity) || 0) +
        quantity;

    if (available === 0) {

        requestStockMessage.textContent =
            "Este material no tiene existencias. Puedes solicitarlo y quedará pendiente de entrega.";

    } else if (combinedQuantity > available) {

        requestStockMessage.textContent =
            "La cantidad solicitada supera las existencias actuales. Las unidades faltantes podrán quedar pendientes.";

    } else {

        requestStockMessage.textContent =
            "Material con existencias disponibles.";

    }

}


// ==========================================
// CAMBIOS EN LOS CAMPOS
// ==========================================

requestUnit.addEventListener("change", () => {

    clearProductFields();
    renderProductOptions();

});

requestProductSearch.addEventListener("input", () => {

    renderProductOptions();

});

requestProduct.addEventListener("change", () => {

    updateAvailableStock();
    updateControls();

});

requestQuantity.addEventListener("input", () => {

    updateAvailableStock();

});


// ==========================================
// AGREGAR MATERIAL AL PEDIDO
// ==========================================

addRequestItemButton.addEventListener("click", () => {

    if (
        !validSession() ||
        !productsReady ||
        savingOrder
    ) {
        return;
    }

    const unit = requestUnit.value;

    const product = getProduct(
        requestProduct.value
    );

    const quantity =
        Number(requestQuantity.value);

    const notes =
        requestNotes.value.trim();

    if (!productMatchesUnit(product, unit)) {

        setCartMessage(
            "Selecciona una unidad y un material válido.",
            "error"
        );

        return;
    }

    if (!validStock(product.quantity)) {

        setCartMessage(
            "Las existencias de este material no son válidas.",
            "error"
        );

        return;
    }

    if (!validQuantity(quantity)) {

        setCartMessage(
            "Ingresa una cantidad entera entre 1 y 1000000.",
            "error"
        );

        return;
    }

    if (notes.length > 5000) {

        setCartMessage(
            "Las observaciones son demasiado largas.",
            "error"
        );

        return;
    }

    const existingItem = cart.find(item =>
        item.productId === product.id
    );

    if (existingItem) {

        const newQuantity =
            Number(existingItem.quantity) +
            quantity;

        if (!validQuantity(newQuantity)) {

            setCartMessage(
                "La cantidad acumulada no es válida.",
                "error"
            );

            return;
        }

        const newNotes = [
            existingItem.notes,
            notes
        ].filter(Boolean).join("\n");

        if (newNotes.length > 5000) {

            setCartMessage(
                "Las observaciones acumuladas son demasiado largas.",
                "error"
            );

            return;
        }

        existingItem.quantity = newQuantity;
        existingItem.notes = newNotes;

    } else {

        if (cart.length >= MAX_ITEMS) {

            setCartMessage(
                `Puedes agregar hasta ${MAX_ITEMS} materiales diferentes por pedido.`,
                "error"
            );

            return;
        }

        cart.push({

            productId: product.id,

            productName: product.name,

            unit,

            quantity,

            notes

        });

    }

    clearProductFields();

    renderProductOptions();
    renderCart();

    setCartMessage(
        "Material agregado correctamente.",
        "success"
    );

});


// ==========================================
// MOSTRAR CARRITO
// ==========================================

function renderCart() {

    requestCartTable.replaceChildren();

    if (cart.length === 0) {

        showTableMessage(

            requestCartTable,

            "Todavía no has agregado materiales a tu pedido.",

            5

        );

        updateCartSummary();

        return;
    }

    cart.forEach(item => {

        const product =
            getProduct(item.productId);

        const row =
            document.createElement("tr");

        // NOMBRE DEL MATERIAL

        appendCell(
            row,
            product?.name || item.productName
        );

        // EXISTENCIAS

        const availableCell = appendCell(

            row,

            validStock(product?.quantity)
                ? product.quantity
                : "No disponible"

        );

        if (
            product &&
            validStock(product.quantity) &&
            Number(item.quantity) > product.quantity
        ) {

            availableCell.className =
                "cart-stock-warning";

        }

        // CANTIDAD EDITABLE

        const quantityCell =
            document.createElement("td");

        const quantityInput =
            document.createElement("input");

        quantityInput.type = "number";
        quantityInput.min = "1";
        quantityInput.max = String(MAX_QUANTITY);
        quantityInput.step = "1";

        quantityInput.value = item.quantity;

        quantityInput.className =
            "cart-quantity-input";

        quantityInput.setAttribute(
            "aria-label",
            `Cantidad de ${item.productName}`
        );

        quantityInput.disabled =
            savingOrder || !validSession();

        quantityInput.addEventListener(
            "input",
            () => {

                item.quantity =
                    quantityInput.value;

                const valid =
                    validQuantity(Number(item.quantity));

                quantityInput.setAttribute(
                    "aria-invalid",
                    String(!valid)
                );

                if (!valid) {

                    setCartMessage(
                        "Revisa las cantidades de tu pedido.",
                        "error"
                    );

                } else {

                    setCartMessage("");

                }

                availableCell.className =
                    product &&
                    Number(item.quantity) > product.quantity
                        ? "cart-stock-warning"
                        : "";

                updateCartSummary();

            }
        );

        quantityCell.appendChild(
            quantityInput
        );

        row.appendChild(quantityCell);

        // OBSERVACIONES EDITABLES

        const notesCell =
            document.createElement("td");

        const notesInput =
            document.createElement("textarea");

        notesInput.rows = 2;
        notesInput.maxLength = 5000;
        notesInput.value = item.notes;

        notesInput.className =
            "cart-notes-input";

        notesInput.placeholder =
            "Opcional";

        notesInput.setAttribute(
            "aria-label",
            `Observaciones de ${item.productName}`
        );

        notesInput.disabled =
            savingOrder || !validSession();

        notesInput.addEventListener(
            "input",
            () => {

                item.notes =
                    notesInput.value;

                updateControls();

            }
        );

        notesCell.appendChild(notesInput);
        row.appendChild(notesCell);

        // ELIMINAR MATERIAL

        const actionsCell =
            document.createElement("td");

        const removeButton =
            document.createElement("button");

        removeButton.type = "button";

        removeButton.className =
            "action-button delete";

        removeButton.textContent =
            "Quitar";

        removeButton.disabled =
            savingOrder || !validSession();

        removeButton.addEventListener(
            "click",
            () => {

                if (
                    savingOrder ||
                    !validSession()
                ) {
                    return;
                }

                cart = cart.filter(
                    cartItem =>
                        cartItem.productId !== item.productId
                );

                renderCart();
                updateAvailableStock();

                setCartMessage(
                    "Material retirado del pedido."
                );

            }
        );

        actionsCell.appendChild(removeButton);
        row.appendChild(actionsCell);

        requestCartTable.appendChild(row);

    });

    updateCartSummary();
}


// ==========================================
// RESUMEN DEL CARRITO
// ==========================================

function updateCartSummary() {

    let totalUnits = 0;

    cart.forEach(item => {

        const quantity =
            Number(item.quantity);

        if (validQuantity(quantity)) {

            totalUnits += quantity;

        }

    });

    requestCartCount.textContent =
        cart.length;

    requestCartUnits.textContent =
        totalUnits;

    updateControls();

}


// ==========================================
// VACIAR CARRITO
// ==========================================

clearRequestCartButton.addEventListener("click", () => {

    if (
        !validSession() ||
        savingOrder ||
        cart.length === 0
    ) {
        return;
    }

    const confirmed = confirm(
        "¿Deseas quitar todos los materiales del pedido?"
    );

    if (!confirmed) return;

    cart = [];

    renderCart();
    renderProductOptions();

    setCartMessage(
        "La lista de materiales se ha vaciado."
    );

});


// ==========================================
// ENVIAR PEDIDO COMPLETO
// ==========================================

requestForm.addEventListener("submit", async event => {

    event.preventDefault();

    if (
        !validSession() ||
        !productsReady ||
        savingOrder
    ) {
        return;
    }

    const revision = sessionRevision;

    const user = {

        uid: currentUser.uid,

        email: currentUser.email,

        name: getTeacherName()

    };

    const unit = requestUnit.value;

    const generalNotes =
        requestGeneralNotes.value.trim();

    if (!validUnits.includes(unit)) {

        setRequestMessage(
            "Selecciona una unidad.",
            "error"
        );

        return;
    }

    if (
        cart.length === 0 ||
        cart.length > MAX_ITEMS
    ) {

        setRequestMessage(
            `Agrega entre 1 y ${MAX_ITEMS} materiales.`,
            "error"
        );

        return;
    }

    // EVITAR ENVIAR SIN AGREGAR EL MATERIAL ACTUAL

    if (
        requestProduct.value ||
        requestQuantity.value ||
        requestNotes.value.trim()
    ) {

        setRequestMessage(
            "Agrega el material que estás seleccionando al carrito o limpia esos campos antes de enviar.",
            "error"
        );

        return;
    }

    if (generalNotes.length > 5000) {

        setRequestMessage(
            "Las observaciones generales son demasiado largas.",
            "error"
        );

        return;
    }

    const items = [];

    for (const item of cart) {

        const product =
            getProduct(item.productId);

        const quantity =
            Number(item.quantity);

        if (
            !productMatchesUnit(product, unit) ||
            !validQuantity(quantity) ||
            !validStock(product?.quantity) ||
            item.unit !== unit
        ) {

            setRequestMessage(
                "Revisa los materiales y las cantidades antes de enviar.",
                "error"
            );

            return;
        }

        const notes =
            item.notes.trim();

        if (notes.length > 5000) {

            setRequestMessage(
                "Revisa las observaciones de los materiales.",
                "error"
            );

            return;
        }

        items.push({

            productId: product.id,

            productName: product.name,

            productUnit: product.unit,

            quantity,

            notes

        });

    }

    const totalUnits = items.reduce(
        (total, item) =>
            total + item.quantity,
        0
    );

    const confirmed = confirm(

        "¿Deseas enviar este pedido?\n\n" +

        `Unidad: ${unit}\n` +

        `Materiales diferentes: ${items.length}\n` +

        `Total de unidades: ${totalUnits}\n\n` +

        "El inventario se descontará cuando se registren las entregas."

    );

    if (!confirmed) return;

    savingOrder = true;

    updateControls();
    renderCart();

    setRequestMessage(
        "Enviando todos los materiales..."
    );

    try {

        // IDENTIFICADOR ÚNICO DEL PEDIDO

        const orderId =
            doc(requestsCollection).id;

        // OPERACIÓN CONJUNTA:
        // TODOS LOS MATERIALES O NINGUNO

        const batch = writeBatch(db);

        items.forEach(item => {

            const requestReference =
                doc(requestsCollection);

            batch.set(requestReference, {

                orderId,

                teacherName: user.name,

                teacherEmail: user.email,

                teacherId: user.uid,

                unit,

                productId: item.productId,

                productName: item.productName,

                productUnit: item.productUnit,

                requestedQuantity: item.quantity,

                deliveredQuantity: 0,

                pendingQuantity: item.quantity,

                status: "Pendiente",

                notes: item.notes,

                generalNotes,

                createdBy: user.uid,

                createdAt: serverTimestamp(),

                updatedAt: serverTimestamp()

            });

        });

        if (!validSession(revision)) {

            throw new Error(
                "La sesión cambió antes de enviar el pedido."
            );

        }

        await batch.commit();

        if (!validSession(revision)) {
            return;
        }

        resetOrderForm();

        setRequestMessage(

            `Pedido ${orderId} registrado correctamente. ${items.length} materiales enviados.`,

            "success"

        );

    } catch (error) {

        console.error(
            "Error al enviar pedido:",
            error
        );

        if (validSession(revision)) {

            setRequestMessage(

                "No se pudo confirmar el envío. Revisa el historial antes de intentarlo nuevamente. " +
                error.message,

                "error"

            );

        }

    } finally {

        if (validSession(revision)) {

            savingOrder = false;

            renderProductOptions();
            renderCart();
            updateControls();

        }

    }

});


// ==========================================
// AGRUPAR PEDIDOS
// ==========================================

function groupOrders() {

    const groups = new Map();

    requests.forEach(request => {

        // COMPATIBILIDAD CON SOLICITUDES ANTERIORES

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

                teacherName:
                    request.teacherName ||
                    request.teacherEmail ||
                    "Usuario",

                teacherEmail:
                    request.teacherEmail || "",

                unit:
                    request.unit || "—",

                createdAt:
                    request.createdAt,

                generalNotes:
                    request.generalNotes || "",

                items: [],

                requested: 0,

                delivered: 0,

                pending: 0,

                status: "Pendiente"

            });

        }

        const order = groups.get(key);

        order.items.push(request);

        order.requested +=
            Number(request.requestedQuantity) || 0;

        order.delivered +=
            Number(request.deliveredQuantity) || 0;

        order.pending +=
            Number(request.pendingQuantity) || 0;

    });

    const orders =
        Array.from(groups.values());

    orders.forEach(order => {

        if (order.pending === 0) {

            order.status = "Entregada";

        } else if (order.delivered > 0) {

            order.status = "Parcial";

        } else {

            order.status = "Pendiente";

        }

    });

    return orders.sort((a, b) => {

        const dateA =
            a.createdAt?.toMillis?.() || 0;

        const dateB =
            b.createdAt?.toMillis?.() || 0;

        return dateB - dateA;

    });

}


// ==========================================
// FORMATO DE FECHA
// ==========================================

function formatDate(timestamp) {

    if (
        !timestamp ||
        typeof timestamp.toDate !== "function"
    ) {

        return "—";

    }

    return timestamp.toDate().toLocaleString(

        "es-CR",

        {

            timeZone: "America/Costa_Rica",

            day: "2-digit",

            month: "2-digit",

            year: "numeric",

            hour: "2-digit",

            minute: "2-digit"

        }

    );

}


// ==========================================
// CREAR INDICADOR DE ESTADO
// ==========================================

function createStatusBadge(status) {

    const badge =
        document.createElement("span");

    const validStatuses = [
        "Pendiente",
        "Parcial",
        "Entregada"
    ];

    const safeStatus =
        validStatuses.includes(status)
            ? status
            : "Pendiente";

    badge.className =

        "request-status " +

        safeStatus.toLowerCase();

    badge.textContent =
        safeStatus;

    return badge;

}


// ==========================================
// MOSTRAR HISTORIAL DE PEDIDOS
// ==========================================

function renderRequests() {

    const orders = groupOrders();

    updateRequestSummary(orders);

    requestTable.replaceChildren();

    if (!validSession()) {

        showTableMessage(

            requestTable,

            "Conecta tu cuenta Google para consultar los pedidos.",

            10

        );

        return;
    }

    if (!requestsReady) {

        showTableMessage(

            requestTable,

            "Esperando información de solicitudes...",

            10

        );

        return;
    }

    const search =
        normalize(requestHistorySearch.value);

    const selectedStatus =
        requestStatusFilter.value;

    const selectedUnit =
        requestUnitFilter.value;

    const filteredOrders = orders.filter(order => {

        const searchText = normalize([

            order.id,

            order.teacherName,

            order.teacherEmail,

            order.unit,

            order.generalNotes,

            ...order.items.map(item =>
                item.productName
            )

        ].join(" "));

        const matchesSearch =
            searchText.includes(search);

        const matchesStatus =
            selectedStatus === "Todos" ||
            order.status === selectedStatus;

        const matchesUnit =
            selectedUnit === "Todas" ||
            order.unit === selectedUnit;

        return (
            matchesSearch &&
            matchesStatus &&
            matchesUnit
        );

    });

    if (filteredOrders.length === 0) {

        showTableMessage(

            requestTable,

            orders.length
                ? "No se encontraron pedidos con estos filtros."
                : "Todavía no hay pedidos registrados.",

            10

        );

        return;
    }

    filteredOrders.forEach(order => {

        // ENCABEZADO DEL PEDIDO COMPLETO

        const headerRow =
            document.createElement("tr");

        headerRow.className =
            "order-header-row";

        const headerCell =
            document.createElement("td");

        headerCell.colSpan = 10;

        const headerContent =
            document.createElement("div");

        headerContent.className =
            "order-header-content";

        const title =
            document.createElement("strong");

        title.textContent =
            `Pedido ${order.id}`;

        const description =
            document.createElement("span");

        description.textContent =

            ` — ${order.items.length} materiales` +

            ` · ${order.requested} unidades solicitadas` +

            ` · ${order.pending} pendientes`;

        headerContent.appendChild(title);
        headerContent.appendChild(description);

        headerContent.appendChild(
            createStatusBadge(order.status)
        );

        headerCell.appendChild(headerContent);

        if (order.generalNotes) {

            const generalNotes =
                document.createElement("p");

            generalNotes.className =
                "order-general-notes";

            generalNotes.textContent =

                "Observaciones generales: " +

                order.generalNotes;

            headerCell.appendChild(generalNotes);

        }

        headerRow.appendChild(headerCell);

        requestTable.appendChild(headerRow);

        // MATERIALES DEL PEDIDO

        order.items.forEach(request => {

            const row =
                document.createElement("tr");

            row.className =
                "order-item-row";

            appendCell(
                row,
                order.id
            );

            appendCell(
                row,
                formatDate(request.createdAt)
            );

            appendCell(
                row,
                order.teacherName
            );

            appendCell(
                row,
                request.unit
            );

            const productCell =
                appendCell(
                    row,
                    request.productName
                );

            if (request.notes) {

                const notes =
                    document.createElement("small");

                notes.className =
                    "order-item-notes";

                notes.textContent =
                    request.notes;

                productCell.appendChild(notes);

            }

            appendCell(
                row,
                request.requestedQuantity ?? 0
            );

            appendCell(
                row,
                request.deliveredQuantity ?? 0
            );

            appendCell(
                row,
                request.pendingQuantity ?? 0
            );

            const statusCell =
                document.createElement("td");

            statusCell.appendChild(

                createStatusBadge(
                    request.status
                )

            );

            row.appendChild(statusCell);

            // ACCIONES DE ADMINISTRACIÓN

            const actionsCell =
                document.createElement("td");

            const pending =
                Number(request.pendingQuantity) || 0;

            if (isAdmin && pending > 0) {

                const button =
                    document.createElement("button");

                button.type = "button";

                button.className =
                    "action-button";

                button.textContent =
                    "Registrar entrega";

                button.disabled = delivering;

                button.addEventListener(
                    "click",
                    () => registerDelivery(request.id)
                );

                actionsCell.appendChild(button);

            } else {

                actionsCell.textContent =
                    pending === 0
                        ? "Completada"
                        : "Pendiente de entrega";

            }

            row.appendChild(actionsCell);

            requestTable.appendChild(row);

        });

    });

}


// ==========================================
// INDICADORES DE PEDIDOS
// ==========================================

function updateRequestSummary(orders = groupOrders()) {

    const pending = orders.filter(order =>
        order.pending > 0
    ).length;

    const completed = orders.filter(order =>
        order.pending === 0
    ).length;

    requestCount.textContent =
        orders.length;

    requestPendingCount.textContent =
        pending;

    requestDeliveredCount.textContent =
        completed;

}


// ==========================================
// FILTROS DEL HISTORIAL
// ==========================================

requestHistorySearch.addEventListener(
    "input",
    renderRequests
);

requestStatusFilter.addEventListener(
    "change",
    renderRequests
);

requestUnitFilter.addEventListener(
    "change",
    renderRequests
);


// ==========================================
// REGISTRAR ENTREGA INDIVIDUAL
// ==========================================

async function registerDelivery(requestId) {

    if (
        !validSession() ||
        !isAdmin ||
        !requestsReady ||
        delivering
    ) {

        return;

    }

    const revision = sessionRevision;

    const request = requests.find(
        item => item.id === requestId
    );

    if (!request) {

        alert("No se encontró el material solicitado.");

        return;
    }

    const pending =
        Number(request.pendingQuantity);

    if (
        !Number.isSafeInteger(pending) ||
        pending <= 0
    ) {

        alert("Esta solicitud no tiene cantidades pendientes.");

        return;
    }

    const product =
        getProduct(request.productId);

    const available =
        product
            ? product.quantity
            : "No disponible";

    const answer = prompt(

        `Material: ${request.productName}\n` +

        `Cantidad pendiente: ${pending}\n` +

        `Existencias actuales: ${available}\n\n` +

        "¿Cuántas unidades vas a entregar?"

    );

    if (answer === null) return;

    const quantityToDeliver =
        Number(answer);

    if (
        answer.trim() === "" ||
        !Number.isSafeInteger(quantityToDeliver) ||
        quantityToDeliver <= 0
    ) {

        alert(
            "Ingresa una cantidad entera mayor que cero."
        );

        return;
    }

    if (quantityToDeliver > pending) {

        alert(
            `No puedes entregar más de ${pending} unidades.`
        );

        return;
    }

    const confirmed = confirm(

        `¿Confirmas la entrega de ${quantityToDeliver} unidades de ${request.productName}?\n\n` +

        "Esta operación descontará las existencias del inventario."

    );

    if (!confirmed) return;

    const deliveryUser = {

        uid: currentUser.uid,

        name:
            currentUser.displayName || "",

        email:
            currentUser.email || ""

    };

    const requestReference =
        doc(
            db,
            "solicitudes",
            requestId
        );

    const movementReference =
        doc(movementsCollection);

    delivering = true;

    renderRequests();

    try {

        await runTransaction(

            db,

            async transaction => {

                if (
                    !validSession(revision) ||
                    !isAdmin
                ) {

                    throw new Error(
                        "La sesión administrativa cambió."
                    );

                }

                // LEER SOLICITUD ACTUAL

                const requestSnapshot =
                    await transaction.get(
                        requestReference
                    );

                if (!requestSnapshot.exists()) {

                    throw new Error(
                        "La solicitud ya no existe."
                    );

                }

                const currentRequest =
                    requestSnapshot.data();

                const productReference =
                    doc(
                        db,
                        "productos",
                        currentRequest.productId
                    );

                // LEER INVENTARIO ACTUAL

                const productSnapshot =
                    await transaction.get(
                        productReference
                    );

                if (!productSnapshot.exists()) {

                    throw new Error(
                        "El producto ya no existe en el inventario."
                    );

                }

                const currentProduct =
                    productSnapshot.data();

                const stock =
                    currentProduct.quantity;

                if (!validStock(stock)) {

                    throw new Error(
                        "Las existencias del producto no son válidas."
                    );

                }

                const requested =
                    currentRequest.requestedQuantity;

                const alreadyDelivered =
                    currentRequest.deliveredQuantity;

                const currentPending =
                    currentRequest.pendingQuantity;

                if (

                    !Number.isSafeInteger(requested) ||

                    requested <= 0 ||

                    !validStock(alreadyDelivered) ||

                    !validStock(currentPending) ||

                    requested - alreadyDelivered !== currentPending

                ) {

                    throw new Error(
                        "Las cantidades de la solicitud no son válidas."
                    );

                }

                if (
                    quantityToDeliver > currentPending
                ) {

                    throw new Error(
                        "La cantidad pendiente cambió. Revisa el pedido."
                    );

                }

                if (
                    quantityToDeliver > stock
                ) {

                    throw new Error(

                        `Existencias insuficientes. Actualmente hay ${stock} unidades.`

                    );

                }

                const newStock =
                    stock - quantityToDeliver;

                const newDelivered =
                    alreadyDelivered +
                    quantityToDeliver;

                const newPending =
                    requested - newDelivered;

                const newStatus =
                    newPending === 0
                        ? "Entregada"
                        : "Parcial";

                if (
                    !validSession(revision) ||
                    !isAdmin
                ) {

                    throw new Error(
                        "La sesión administrativa cambió."
                    );

                }

                // ACTUALIZAR INVENTARIO

                transaction.update(

                    productReference,

                    {

                        quantity: newStock,

                        updatedAt:
                            serverTimestamp()

                    }

                );

                // ACTUALIZAR SOLICITUD

                transaction.update(

                    requestReference,

                    {

                        deliveredQuantity:
                            newDelivered,

                        pendingQuantity:
                            newPending,

                        status:
                            newStatus,

                        updatedAt:
                            serverTimestamp(),

                        lastDeliveryAt:
                            serverTimestamp(),

                        lastDeliveredBy:
                            deliveryUser.email

                    }

                );

                // REGISTRAR MOVIMIENTO AUTOMÁTICO

                transaction.set(

                    movementReference,

                    {

                        productId:
                            currentRequest.productId,

                        productName:
                            currentProduct.name ||
                            currentRequest.productName,

                        productUnit:
                            currentProduct.unit ||
                            currentRequest.productUnit,

                        type: "Salida",

                        quantity:
                            quantityToDeliver,

                        difference:
                            -quantityToDeliver,

                        previousQuantity:
                            stock,

                        newQuantity:
                            newStock,

                        reason:
                            "Entrega de solicitud docente",

                        notes:
                            currentRequest.notes || "",

                        orderId:
                            currentRequest.orderId ||
                            requestId,

                        requestId,

                        teacherId:
                            currentRequest.teacherId || "",

                        teacherName:
                            currentRequest.teacherName || "",

                        teacherEmail:
                            currentRequest.teacherEmail || "",

                        createdBy:
                            deliveryUser.uid,

                        createdByName:
                            deliveryUser.name,

                        createdByEmail:
                            deliveryUser.email,

                        createdAt:
                            serverTimestamp()

                    }

                );

            }

        );

        if (validSession(revision)) {

            alert(

                "Entrega registrada correctamente.\n\n" +

                "✓ Pedido actualizado.\n" +

                "✓ Inventario descontado.\n" +

                "✓ Salida registrada en Movimientos."

            );

        }

    } catch (error) {

        console.error(
            "Error al registrar entrega:",
            error
        );

        if (validSession(revision)) {

            alert(

                "No fue posible confirmar la entrega. Revisa el historial.\n\n" +

                error.message

            );

        }

    } finally {

        if (validSession(revision)) {

            delivering = false;

            renderRequests();

        }

    }

}


// ==========================================
// CANCELAR CONSULTAS ANTERIORES
// ==========================================

function stopListeners() {

    if (unsubscribeProducts) {

        unsubscribeProducts();

        unsubscribeProducts = null;

    }

    if (unsubscribeRequests) {

        unsubscribeRequests();

        unsubscribeRequests = null;

    }

}


// ==========================================
// LIMPIAR SESIÓN
// ==========================================

function clearSession() {

    sessionRevision++;

    stopListeners();

    currentUser = null;
    isAdmin = false;

    products = [];
    requests = [];
    cart = [];

    productsReady = false;
    requestsReady = false;

    savingOrder = false;
    delivering = false;

    requestTeacher.value = "";

    requestHistorySearch.value = "";

    requestStatusFilter.value = "Todos";

    requestUnitFilter.value = "Todas";

    resetOrderForm();

    renderRequests();

    setRequestMessage(

        "Conecta tu cuenta Google para registrar solicitudes."

    );

    updateControls();

}


// ==========================================
// CAMBIOS DE USUARIO
// ==========================================

window.addEventListener(

    "firebase-user-changed",

    event => {

        if (!event.detail) {

            clearSession();

        }

    }

);


// ==========================================
// CAMBIOS DE ROL Y CONEXIÓN
// ==========================================

window.addEventListener(

    "firebase-role-changed",

    event => {

        const details =
            event.detail || {};

        clearSession();

        if (!details.user) {
            return;
        }

        currentUser =
            details.user;

        isAdmin =
            details.isAdmin === true;

        const revision =
            sessionRevision;

        requestTeacher.value =
            getTeacherName();

        setRequestMessage(
            "Cargando materiales y solicitudes..."
        );

        renderProductOptions();
        renderRequests();
        updateControls();

        // CONSULTAR INVENTARIO

        const productsQuery = query(

            productsCollection,

            orderBy("name")

        );

        unsubscribeProducts = onSnapshot(

            productsQuery,

            {
                includeMetadataChanges: true
            },

            snapshot => {

                if (!validSession(revision)) {
                    return;
                }

                products = snapshot.docs.map(

                    documentSnapshot => ({

                        ...documentSnapshot.data(),

                        id: documentSnapshot.id

                    })

                );

                productsReady =
                    !snapshot.metadata.fromCache;

                renderProductOptions();
                renderCart();

                if (
                    productsReady &&
                    !savingOrder &&
                    requestMessage.textContent ===
                        "Cargando materiales y solicitudes..."
                ) {

                    setRequestMessage(

                        "Puedes agregar materiales a tu pedido.",

                        "success"

                    );

                }

                updateControls();

            },

            error => {

                if (!validSession(revision)) {
                    return;
                }

                console.error(

                    "Error al consultar inventario:",

                    error

                );

                productsReady = false;

                products = [];

                renderProductOptions();
                renderCart();

                setRequestMessage(

                    "No fue posible consultar el inventario.",

                    "error"

                );

                updateControls();

            }

        );

        // CONSULTAR SOLICITUDES SEGÚN EL ROL

        const requestsQuery = isAdmin

            ? query(

                requestsCollection,

                orderBy("createdAt", "desc")

            )

            : query(

                requestsCollection,

                where(
                    "teacherId",
                    "==",
                    currentUser.uid
                ),

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

                requestsReady =
                    !snapshot.metadata.fromCache;

                requests = requestsReady

                    ? snapshot.docs.map(

                        documentSnapshot => ({

                            ...documentSnapshot.data(),

                            id: documentSnapshot.id

                        })

                    )

                    : [];

                renderRequests();
                updateControls();

            },

            error => {

                if (!validSession(revision)) {
                    return;
                }

                console.error(

                    "Error al consultar solicitudes:",

                    error

                );

                requestsReady = false;

                requests = [];

                updateRequestSummary();

                showTableMessage(

                    requestTable,

                    "No fue posible consultar los pedidos. Revisa los permisos y los índices de Firebase.",

                    10

                );

                updateControls();

            }

        );

    }

);


// ==========================================
// ESTADO INICIAL
// ==========================================

clearSession();


// ==========================================
// FIN DEL MÓDULO DE SOLICITUDES
// ==========================================
