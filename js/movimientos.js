
import { db } from "./firebase.js";

import {
    collection,
    doc,
    onSnapshot,
    query,
    orderBy,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =====================================
// ELEMENTOS DEL FORMULARIO
// =====================================

const movementForm =
    document.getElementById("movementForm");

const movementType =
    document.getElementById("movementType");

const movementProduct =
    document.getElementById("movementProduct");

const movementQuantity =
    document.getElementById("movementQuantity");

const movementReason =
    document.getElementById("movementReason");

const movementNotes =
    document.getElementById("movementNotes");

const movementCurrentStock =
    document.getElementById("movementCurrentStock");

const movementQuantityLabel =
    document.getElementById("movementQuantityLabel");

const movementMessage =
    document.getElementById("movementMessage");

const saveMovementButton =
    document.getElementById("saveMovementButton");

const movementTable =
    document.getElementById("movementTable");

// =====================================
// ESTADO DEL MÓDULO
// =====================================

let currentUser = null;
let isAdmin = false;
let sessionRevision = 0;
let savingMovement = false;
let productsLoaded = false;

let products = [];
let movements = [];

let unsubscribeProducts = null;
let unsubscribeMovements = null;

const validTypes = [
    "Entrada",
    "Salida",
    "Ajuste"
];

const productsCollection =
    collection(db, "productos");

const movementsCollection =
    collection(db, "movimientos");

// =====================================
// CONTROL DE PERMISOS
// =====================================

function hasAdminAccess() {

    return currentUser !== null &&
        isAdmin === true;
}

function validSession(revision) {

    return revision === sessionRevision &&
        hasAdminAccess();
}

// =====================================
// CONTROL DEL FORMULARIO
// =====================================

function updateFormAccess() {

    const enabled =
        hasAdminAccess() &&
        productsLoaded &&
        !savingMovement &&
        products.length > 0;

    movementForm
        .querySelectorAll("input, select, textarea, button")
        .forEach(element => {

            element.disabled = !enabled;

        });
}

// =====================================
// MENSAJES
// =====================================

function setMovementMessage(message, type = "") {

    movementMessage.textContent = message;

    movementMessage.className = "form-message";

    if (type) {

        movementMessage.classList.add(type);
    }
}

function showMovementTableMessage(message) {

    movementTable.replaceChildren();

    const row = document.createElement("tr");

    const cell = document.createElement("td");

    cell.colSpan = 8;

    cell.className = "empty-message";

    cell.textContent = message;

    row.appendChild(cell);

    movementTable.appendChild(row);
}

// =====================================
// CARGAR PRODUCTOS EN EL SELECTOR
// =====================================

function renderMovementProducts() {

    const selectedProduct =
        movementProduct.value;

    movementProduct.replaceChildren();

    if (!hasAdminAccess()) {

        movementProduct.add(
            new Option("Sin acceso", "")
        );

        movementCurrentStock.textContent = "—";

        updateFormAccess();

        return;
    }

    if (!productsLoaded) {

        movementProduct.add(
            new Option("Cargando productos...", "")
        );

        movementCurrentStock.textContent = "—";

        updateFormAccess();

        return;
    }

    if (products.length === 0) {

        movementProduct.add(
            new Option("No hay productos registrados", "")
        );

        movementCurrentStock.textContent = "—";

        updateFormAccess();

        return;
    }

    movementProduct.add(

        new Option("Seleccionar producto", "")

    );

    products.forEach(product => {

        const validQuantity =
            Number.isSafeInteger(product.quantity) &&
            product.quantity >= 0;

        const quantity = validQuantity
            ? product.quantity
            : "Stock inválido";

        movementProduct.add(

            new Option(

                `${product.name || "Producto"} — ${quantity} (${product.unit || "Sin unidad"})`,

                product.id
            )
        );
    });

    if (
        products.some(
            product => product.id === selectedProduct
        )
    ) {

        movementProduct.value = selectedProduct;
    }

    updateCurrentStock();

    updateFormAccess();
}

// =====================================
// MOSTRAR EXISTENCIAS ACTUALES
// =====================================

function updateCurrentStock() {

    if (!hasAdminAccess()) {

        movementCurrentStock.textContent = "—";

        return;
    }

    const product = products.find(

        item => item.id === movementProduct.value

    );

    if (!product) {

        movementCurrentStock.textContent =
            "Selecciona un producto";

        return;
    }

    const quantity = product.quantity;

    if (
        !Number.isSafeInteger(quantity) ||
        quantity < 0
    ) {

        movementCurrentStock.textContent =
            "Existencias inválidas";

        return;
    }

    movementCurrentStock.textContent =
        `${quantity} unidades`;
}

// =====================================
// CAMBIAR TEXTO SEGÚN EL MOVIMIENTO
// =====================================

function updateMovementType() {

    movementQuantity.step = "1";

    if (movementType.value === "Ajuste") {

        movementQuantity.min = "0";

        movementQuantityLabel.textContent =
            "Cantidad real del producto";

        movementQuantity.placeholder =
            "Escribe la cantidad real que hay";

    } else {

        movementQuantity.min = "1";

        movementQuantityLabel.textContent =
            "Cantidad del movimiento";

        movementQuantity.placeholder =
            "Escribe la cantidad";
    }
}

movementProduct.addEventListener(

    "change",

    updateCurrentStock
);

movementType.addEventListener(

    "change",

    updateMovementType
);

// =====================================
// CANCELAR CONSULTAS ANTERIORES
// =====================================

function stopListeners() {

    if (unsubscribeProducts) {

        unsubscribeProducts();

        unsubscribeProducts = null;
    }

    if (unsubscribeMovements) {

        unsubscribeMovements();

        unsubscribeMovements = null;
    }
}

// =====================================
// CAMBIOS DE USUARIO Y ROL
// =====================================

window.addEventListener(

    "firebase-role-changed",

    event => {

        const revision = ++sessionRevision;

        const details = event.detail || {};

        currentUser = details.user || null;

        isAdmin = details.isAdmin === true;

        stopListeners();

        products = [];
        movements = [];

        savingMovement = false;
        productsLoaded = false;

        movementForm.reset();

        saveMovementButton.textContent =
            "Registrar movimiento";

        movementCurrentStock.textContent = "—";

        updateMovementType();

        renderMovementProducts();

        renderMovements();

        updateFormAccess();

        // SIN SESIÓN

        if (!currentUser) {

            setMovementMessage(
                "Conecta tu cuenta de Google para registrar movimientos."
            );

            showMovementTableMessage(
                "Conecta tu cuenta de Google para consultar el historial."
            );

            return;
        }

        // SIN PERMISOS

        if (!isAdmin) {

            setMovementMessage(
                "Este módulo está disponible únicamente para la administración."
            );

            showMovementTableMessage(
                "No tienes permisos para consultar este historial."
            );

            return;
        }

        setMovementMessage(
            "Cargando productos..."
        );

        showMovementTableMessage(
            "Cargando historial de movimientos..."
        );

        // =================================
        // ESCUCHAR PRODUCTOS
        // =================================

        const productsQuery = query(

            productsCollection,

            orderBy("name")
        );

        unsubscribeProducts = onSnapshot(

            productsQuery,

            snapshot => {

                if (!validSession(revision)) {
                    return;
                }

                const firstLoad = !productsLoaded;

                products = snapshot.docs.map(
                    document => ({

                        ...document.data(),

                        id: document.id

                    })
                );

                productsLoaded = true;

                renderMovementProducts();

                if (products.length === 0) {

                    setMovementMessage(
                        "Debes registrar un producto en el inventario."
                    );

                } else if (
                    firstLoad &&
                    !savingMovement
                ) {

                    setMovementMessage(

                        "Selecciona un producto para registrar un movimiento.",

                        "success"
                    );
                }
            },

            error => {

                if (!validSession(revision)) {
                    return;
                }

                console.error(
                    "Error al cargar productos:",
                    error
                );

                products = [];

                productsLoaded = false;

                movementProduct.replaceChildren();

                movementProduct.add(
                    new Option("Error al cargar productos", "")
                );

                movementCurrentStock.textContent = "—";

                updateFormAccess();

                setMovementMessage(

                    "No fue posible cargar los productos.",

                    "error"
                );
            }
        );

        // =================================
        // ESCUCHAR HISTORIAL
        // =================================

        const movementsQuery = query(

            movementsCollection,

            orderBy("createdAt", "desc")
        );

        unsubscribeMovements = onSnapshot(

            movementsQuery,

            snapshot => {

                if (!validSession(revision)) {
                    return;
                }

                movements = snapshot.docs.map(
                    document => ({

                        ...document.data(),

                        id: document.id

                    })
                );

                renderMovements();
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

                showMovementTableMessage(
                    "No se pudo cargar el historial. Revisa las reglas de Firestore."
                );
            }
        );
    }
);

// =====================================
// REGISTRAR MOVIMIENTO
// =====================================

movementForm.addEventListener(

    "submit",

    async event => {

        event.preventDefault();

        // COMPROBAR PERMISOS

        if (!hasAdminAccess()) {

            alert(
                "No tienes permisos para registrar movimientos."
            );

            return;
        }

        // EVITAR ENVÍOS DUPLICADOS

        if (savingMovement) return;

        if (!productsLoaded) {

            alert("Los productos no están disponibles.");

            return;
        }

        // CONSERVAR LA SESIÓN RESPONSABLE

        const revision = sessionRevision;

        const user = {

            uid: currentUser.uid,

            name: currentUser.displayName || "",

            email: currentUser.email || ""

        };

        // OBTENER DATOS

        const type = movementType.value;

        const productId = movementProduct.value;

        const quantity =
            Number(movementQuantity.value);

        const reason =
            movementReason.value.trim();

        const notes =
            movementNotes.value.trim();

        // VALIDAR TIPO

        if (!validTypes.includes(type)) {

            alert(
                "Selecciona un tipo de movimiento válido."
            );

            return;
        }

        // VALIDAR CAMPOS

        if (!productId || !reason) {

            alert(
                "Selecciona un producto e indica el motivo."
            );

            return;
        }

        // VALIDAR CANTIDAD

        if (
            movementQuantity.value.trim() === "" ||

            !Number.isSafeInteger(quantity) ||

            quantity < 0
        ) {

            alert(
                "Ingresa una cantidad entera válida."
            );

            return;
        }

        if (
            type !== "Ajuste" &&
            quantity <= 0
        ) {

            alert(
                "La cantidad debe ser mayor que cero."
            );

            return;
        }

        // VALIDAR PRODUCTO

        const selectedProduct = products.find(

            product => product.id === productId

        );

        if (!selectedProduct) {

            alert(
                "El producto seleccionado ya no existe."
            );

            return;
        }

        savingMovement = true;

        updateFormAccess();

        saveMovementButton.textContent =
            "Guardando...";

        setMovementMessage(
            "Registrando movimiento..."
        );

        const productReference = doc(

            db,

            "productos",

            productId
        );

        const movementReference =
            doc(movementsCollection);

        try {

            await runTransaction(

                db,

                async transaction => {

                    // COMPROBAR SESIÓN ACTUAL

                    if (!validSession(revision)) {

                        throw new Error(
                            "La sesión cambió durante la operación."
                        );
                    }

                    // CONSULTAR EXISTENCIAS REALES

                    const productSnapshot =
                        await transaction.get(
                            productReference
                        );

                    if (!validSession(revision)) {

                        throw new Error(
                            "La sesión cambió durante la operación."
                        );
                    }

                    if (!productSnapshot.exists()) {

                        throw new Error(
                            "El producto ya no existe."
                        );
                    }

                    const product =
                        productSnapshot.data();

                    const previousQuantity =
                        product.quantity;

                    // VALIDAR EXISTENCIAS GUARDADAS

                    if (
                        !Number.isSafeInteger(
                            previousQuantity
                        ) ||

                        previousQuantity < 0
                    ) {

                        throw new Error(
                            "Las existencias registradas no son válidas. Revisa el producto en Inventario."
                        );
                    }

                    let newQuantity =
                        previousQuantity;

                    // =========================
                    // ENTRADA
                    // =========================

                    if (type === "Entrada") {

                        newQuantity =
                            previousQuantity +
                            quantity;
                    }

                    // =========================
                    // SALIDA
                    // =========================

                    if (type === "Salida") {

                        if (
                            quantity >
                            previousQuantity
                        ) {

                            throw new Error(

                                `No hay suficientes existencias. Actualmente hay ${previousQuantity}.`

                            );
                        }

                        newQuantity =
                            previousQuantity -
                            quantity;
                    }

                    // =========================
                    // AJUSTE
                    // =========================

                    if (type === "Ajuste") {

                        newQuantity = quantity;

                        if (
                            newQuantity ===
                            previousQuantity
                        ) {

                            throw new Error(
                                "La cantidad nueva es igual a la cantidad actual. No hay nada que ajustar."
                            );
                        }
                    }

                    // VALIDAR NUEVAS EXISTENCIAS

                    if (
                        !Number.isSafeInteger(
                            newQuantity
                        ) ||

                        newQuantity < 0
                    ) {

                        throw new Error(
                            "La cantidad resultante del inventario no es válida."
                        );
                    }

                    const difference =
                        newQuantity -
                        previousQuantity;

                    const movementDifference =
                        Math.abs(difference);

                    // =========================
                    // ACTUALIZAR INVENTARIO
                    // =========================

                    transaction.update(

                        productReference,

                        {

                            quantity: newQuantity,

                            updatedAt:
                                serverTimestamp()

                        }
                    );

                    // =========================
                    // REGISTRAR HISTORIAL
                    // =========================

                    transaction.set(

                        movementReference,

                        {

                            productId,

                            productName:
                                product.name || "",

                            productUnit:
                                product.unit || "",

                            type,

                            quantity:
                                movementDifference,

                            difference,

                            previousQuantity,

                            newQuantity,

                            reason,

                            notes,

                            createdBy:
                                user.uid,

                            createdByName:
                                user.name,

                            createdByEmail:
                                user.email,

                            createdAt:
                                serverTimestamp()

                        }
                    );
                }
            );

            // COMPROBAR QUE LA SESIÓN NO CAMBIÓ

            if (!validSession(revision)) return;

            movementForm.reset();

            movementProduct.value = "";

            updateCurrentStock();

            updateMovementType();

            setMovementMessage(

                "Movimiento registrado correctamente. El inventario fue actualizado.",

                "success"
            );

        } catch (error) {

            console.error(
                "Error al registrar movimiento:",
                error
            );

            if (!validSession(revision)) return;

            setMovementMessage(

                "No se pudo registrar el movimiento: " +
                error.message,

                "error"
            );

        } finally {

            if (validSession(revision)) {

                savingMovement = false;

                saveMovementButton.textContent =
                    "Registrar movimiento";

                updateFormAccess();
            }
        }
    }
);

// =====================================
// FORMATO DE FECHA
// =====================================

function formatMovementDate(timestamp) {

    if (
        !timestamp ||

        typeof timestamp.toDate !== "function"
    ) {

        return "Procesando...";
    }

    const date = timestamp.toDate();

    if (Number.isNaN(date.getTime())) {

        return "—";
    }

    return date.toLocaleString(

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

// =====================================
// MOSTRAR HISTORIAL
// =====================================

function renderMovements() {

    movementTable.replaceChildren();

    if (!hasAdminAccess()) return;

    if (movements.length === 0) {

        showMovementTableMessage(
            "Todavía no hay movimientos registrados."
        );

        return;
    }

    movements.forEach(movement => {

        const row = document.createElement("tr");

        const values = [

            formatMovementDate(
                movement.createdAt
            ),

            movement.productName || "—",

            movement.productUnit || "—",

            movement.quantity ?? 0,

            movement.previousQuantity ?? 0,

            movement.newQuantity ?? 0,

            movement.reason || "—"

        ];

        values.forEach(value => {

            const cell =
                document.createElement("td");

            cell.textContent = value;

            row.appendChild(cell);
        });

        // TIPO DE MOVIMIENTO

        const typeCell =
            document.createElement("td");

        const typeBadge =
            document.createElement("span");

        const type = validTypes.includes(
            movement.type
        )
            ? movement.type
            : "Desconocido";

        typeBadge.className =
            "movement-badge " +
            type.toLowerCase();

        typeBadge.textContent = type;

        typeCell.appendChild(typeBadge);

        row.insertBefore(

            typeCell,

            row.children[1]
        );

        movementTable.appendChild(row);
    });
}

// =====================================
// ESTADO INICIAL
// =====================================

updateFormAccess();

updateMovementType();

showMovementTableMessage(
    "Conecta tu cuenta Google para consultar el historial."
);
