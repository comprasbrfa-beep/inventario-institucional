
import { db } from "./firebase.js";

import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ========================================
// ELEMENTOS HTML
// ========================================

const $ = id => document.getElementById(id);

const supplyProductsCount = $("supplyProductsCount");
const supplyPendingUnits = $("supplyPendingUnits");
const supplyEstimatedCost = $("supplyEstimatedCost");

const supplySearch = $("supplySearch");
const supplyTable = $("supplyTable");
const supplyMessage = $("supplyMessage");

const supplyForm = $("supplyForm");
const supplyProduct = $("supplyProduct");
const supplyProvider = $("supplyProvider");
const supplyUnitPrice = $("supplyUnitPrice");
const supplyPurchaseQuantity = $("supplyPurchaseQuantity");
const supplyPurchaseStatus = $("supplyPurchaseStatus");
const supplyPurchaseNotes = $("supplyPurchaseNotes");
const supplyFormMessage = $("supplyFormMessage");
const saveSupplyButton = $("saveSupplyButton");

const providerForm = $("providerForm");
const providerId = $("providerId");
const providerName = $("providerName");
const providerLocation = $("providerLocation");
const providerPhone = $("providerPhone");
const providerLink = $("providerLink");
const providerNotes = $("providerNotes");
const providerMessage = $("providerMessage");
const saveProviderButton = $("saveProviderButton");
const providerTable = $("providerTable");

// ========================================
// ESTADO DEL MÓDULO
// ========================================

let currentUser = null;
let isAdmin = false;
let sessionRevision = 0;

let busy = false;

let products = [];
let requests = [];
let providers = [];
let purchases = [];

let unsubscribers = [];

const loaded = new Set();

const requiredCollections = [
    "productos",
    "solicitudes",
    "proveedores",
    "compras"
];

// ========================================
// PERMISOS
// ========================================

function hasAdminAccess() {

    return currentUser !== null &&
        isAdmin === true;
}

function validSession(revision) {

    return revision === sessionRevision &&
        hasAdminAccess();
}

function dataReady() {

    return requiredCollections.every(
        name => loaded.has(name)
    );
}

function canOperate() {

    return hasAdminAccess() &&
        dataReady() &&
        !busy;
}

// ========================================
// UTILIDADES
// ========================================

const money = value =>

    new Intl.NumberFormat("es-CR", {

        style: "currency",

        currency: "CRC",

        maximumFractionDigits: 2

    }).format(Number(value) || 0);

function integer(value) {

    const number = Number(value);

    return Number.isSafeInteger(number) &&
        number >= 0
        ? number
        : 0;
}

function escapeHTML(value) {

    return String(value ?? "")

        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function safeURL(value) {

    if (!value) return "";

    try {

        const url = new URL(value);

        if (
            url.protocol === "https:" ||
            url.protocol === "http:"
        ) {

            return url.href;
        }

    } catch {

        return "";
    }

    return "";
}

function showMessage(element, text, type = "") {

    if (!element) return;

    element.textContent = text;

    element.className =
        `form-message ${type}`.trim();
}

function emptyTable(element, columns, message) {

    if (!element) return;

    element.replaceChildren();

    const row = document.createElement("tr");

    const cell = document.createElement("td");

    cell.colSpan = columns;

    cell.className = "empty-message";

    cell.textContent = message;

    row.appendChild(cell);

    element.appendChild(row);
}

// ========================================
// BUSCAR REGISTROS
// ========================================

function getProduct(id) {

    return products.find(
        item => item.id === id
    );
}

function getProvider(id) {

    return providers.find(
        item => item.id === id
    );
}

function getPurchase(productId) {

    return purchases.find(
        item => item.id === productId
    );
}

// ========================================
// SOLICITUDES PENDIENTES
// ========================================

function getPending(productId) {

    return requests

        .filter(
            request =>
                request.productId === productId
        )

        .reduce(

            (total, request) =>

                total +
                integer(request.pendingQuantity),

            0
        );
}

// ========================================
// COMPRAS ANTIGUAS SIN MIGRAR
// ========================================

function isLegacyPurchase(purchase) {

    return purchase?.status === "Comprado" &&

        !Number.isSafeInteger(
            purchase.orderedQuantity
        );
}

// ========================================
// CÁLCULO AUTOMÁTICO DE COMPRAS
// ========================================

function calculatePurchase(
    product,
    purchase,
    pendingOverride
) {

    const available =
        integer(product.quantity);

    const pending =
        pendingOverride === undefined
            ? getPending(product.id)
            : pendingOverride;

    const additional =
        integer(purchase?.additionalQuantity);

    const ordered =
        integer(purchase?.orderedQuantity);

    const shortage =
        Math.max(
            0,
            pending - available
        );

    // Necesidad total, incluyendo compras adicionales.

    const required =
        shortage + additional;

    // Descontar las compras pendientes de recibir.

    const toBuy =
        Math.max(
            0,
            required - ordered
        );

    const rawPrice =
        Number(purchase?.unitPrice);

    const price =
        Number.isFinite(rawPrice) &&
        rawPrice >= 0
            ? rawPrice
            : 0;

    const total =
        toBuy * price;

    let status = "Pendiente";

    if (isLegacyPurchase(purchase)) {

        status = "Revisar compra anterior";

    } else if (toBuy > 0) {

        // REACTIVACIÓN AUTOMÁTICA

        status = "Pendiente";

    } else if (ordered > 0) {

        status = "Comprado";

    } else if (required === 0) {

        status = "Sin compra pendiente";
    }

    return {

        available,
        pending,
        additional,
        ordered,
        shortage,
        required,
        toBuy,
        price,
        total,
        status

    };
}

// ========================================
// CONTROL DE FORMULARIOS
// ========================================

function updateFormAccess() {

    const enabled = canOperate();

    [supplyForm, providerForm].forEach(form => {

        form?.querySelectorAll(
            "input, select, textarea, button"
        ).forEach(element => {

            element.disabled = !enabled;
        });
    });

    if (saveSupplyButton) {

        saveSupplyButton.disabled =

            !enabled ||

            products.length === 0 ||

            providers.length === 0;
    }

    [supplyTable, providerTable].forEach(table => {

        table?.querySelectorAll("button")

            .forEach(button => {

                button.disabled = !enabled;
            });
    });
}

function setBusy(value) {

    busy = value;

    updateFormAccess();
}

function resetProviderForm() {

    providerForm?.reset();

    providerId.value = "";

    saveProviderButton.textContent =
        "Guardar proveedor";
}

function resetSupplyForm() {

    supplyForm?.reset();

    supplyPurchaseQuantity.value = "0";

    saveSupplyButton.textContent =
        "Guardar datos de compra";
}

// ========================================
// OPCIONES DE PRODUCTOS Y PROVEEDORES
// ========================================

function renderOptions() {

    const selectedProduct =
        supplyProduct.value;

    const selectedProvider =
        supplyProvider.value;

    supplyProduct.replaceChildren();

    supplyProduct.add(

        new Option(
            "Seleccionar producto",
            ""
        )
    );

    products.forEach(product => {

        supplyProduct.add(

            new Option(

                `${product.name} (${product.unit || ""})`,

                product.id
            )
        );
    });

    if (getProduct(selectedProduct)) {

        supplyProduct.value =
            selectedProduct;
    }

    supplyProvider.replaceChildren();

    supplyProvider.add(

        new Option(
            "Seleccionar proveedor",
            ""
        )
    );

    providers.forEach(provider => {

        supplyProvider.add(

            new Option(

                provider.name,

                provider.id
            )
        );
    });

    if (getProvider(selectedProvider)) {

        supplyProvider.value =
            selectedProvider;
    }
}

// ========================================
// RESUMEN GENERAL
// ========================================

function renderSummary() {

    supplyProductsCount.textContent =
        products.length;

    const totalPending =
        requests.reduce(

            (total, request) =>

                total +
                integer(request.pendingQuantity),

            0
        );

    supplyPendingUnits.textContent =
        totalPending;

    let estimatedCost = 0;

    let legacyCount = 0;

    products.forEach(product => {

        const purchase =
            getPurchase(product.id);

        const calculation =
            calculatePurchase(product, purchase);

        if (isLegacyPurchase(purchase)) {

            legacyCount++;

            return;
        }

        estimatedCost += calculation.total;
    });

    supplyEstimatedCost.textContent =
        money(estimatedCost);

    if (legacyCount > 0) {

        showMessage(

            supplyMessage,

            `Hay ${legacyCount} compras antiguas que debes revisar. El costo de estos productos no está incluido en el presupuesto hasta completar la revisión.`,

            "error"
        );

    } else if (dataReady()) {

        showMessage(supplyMessage, "");
    }
}

// ========================================
// TABLA DE COMPRAS
// ========================================

function renderSupplyTable() {

    if (!supplyTable) return;

    if (!hasAdminAccess()) {

        emptyTable(

            supplyTable,

            10,

            "Conecta una cuenta administradora."
        );

        return;
    }

    if (!dataReady()) {

        emptyTable(

            supplyTable,

            10,

            "Esperando datos de Firebase..."
        );

        return;
    }

    const search =

        (supplySearch.value || "")

            .trim()

            .toLowerCase();

    const filtered = products.filter(product => {

        const purchase =
            getPurchase(product.id);

        const provider =
            getProvider(purchase?.providerId);

        return [

            product.name,

            product.unit,

            provider?.name

        ].some(value =>

            String(value || "")

                .toLowerCase()

                .includes(search)
        );
    });

    if (filtered.length === 0) {

        emptyTable(

            supplyTable,

            10,

            "No hay productos que mostrar."
        );

        return;
    }

    supplyTable.innerHTML = filtered.map(product => {

        const purchase =
            getPurchase(product.id);

        const provider =
            getProvider(purchase?.providerId);

        const calculation =
            calculatePurchase(product, purchase);

        const legacy =
            isLegacyPurchase(purchase);

        return `

            <tr>

                <td>

                    <strong>
                        ${escapeHTML(product.name)}
                    </strong>

                </td>

                <td>
                    ${escapeHTML(product.unit || "")}
                </td>

                <td>
                    ${calculation.available}
                </td>

                <td>
                    ${calculation.pending}
                </td>

                <td>

                    <strong>
                        ${legacy ? "—" : calculation.toBuy}
                    </strong>

                    ${calculation.ordered > 0 ? `

                        <small style="display:block">

                            Por recibir:
                            ${calculation.ordered}

                        </small>

                    ` : ""}

                </td>

                <td>

                    ${escapeHTML(
                        provider?.name ||
                        "Sin asignar"
                    )}

                </td>

                <td>
                    ${escapeHTML(money(calculation.price))}
                </td>

                <td>

                    <strong>

                        ${legacy

                            ? "Por revisar"

                            : escapeHTML(
                                money(calculation.total)
                            )
                        }

                    </strong>

                </td>

                <td>

                    ${escapeHTML(calculation.status)}

                </td>

                <td>

                    <button

                        type="button"

                        class="action-button"

                        data-edit-purchase="${escapeHTML(product.id)}"

                    >

                        Editar

                    </button>

                    ${!legacy && calculation.ordered > 0 ? `

                        <button

                            type="button"

                            class="action-button"

                            data-receive-purchase="${escapeHTML(product.id)}"

                        >

                            Recibir compra

                        </button>

                    ` : ""}

                    ${legacy ? `

                        <button

                            type="button"

                            class="action-button"

                            data-review-purchase="${escapeHTML(product.id)}"

                        >

                            Revisar

                        </button>

                    ` : ""}

                </td>

            </tr>
        `;

    }).join("");

    updateFormAccess();
}

// ========================================
// TABLA DE PROVEEDORES
// ========================================

function renderProviderTable() {

    if (!providerTable) return;

    if (!hasAdminAccess()) {

        emptyTable(

            providerTable,

            6,

            "Conecta una cuenta administradora."
        );

        return;
    }

    if (providers.length === 0) {

        emptyTable(

            providerTable,

            6,

            "Todavía no hay proveedores registrados."
        );

        return;
    }

    providerTable.innerHTML = providers.map(provider => {

        const link =
            safeURL(provider.link);

        return `

            <tr>

                <td>

                    <strong>
                        ${escapeHTML(provider.name)}
                    </strong>

                </td>

                <td>
                    ${escapeHTML(provider.location || "-")}
                </td>

                <td>
                    ${escapeHTML(provider.phone || "-")}
                </td>

                <td>

                    ${link ? `

                        <a

                            href="${escapeHTML(link)}"

                            target="_blank"

                            rel="noopener noreferrer"

                        >

                            Ver enlace

                        </a>

                    ` : "-"}

                </td>

                <td>
                    ${escapeHTML(provider.notes || "-")}
                </td>

                <td>

                    <button

                        type="button"

                        class="action-button"

                        data-edit-provider="${escapeHTML(provider.id)}"

                    >

                        Editar

                    </button>

                    <button

                        type="button"

                        class="action-button delete"

                        data-delete-provider="${escapeHTML(provider.id)}"

                    >

                        Eliminar

                    </button>

                </td>

            </tr>
        `;

    }).join("");

    updateFormAccess();
}

// ========================================
// ACTUALIZAR INTERFAZ
// ========================================

function renderAll() {

    renderOptions();

    if (hasAdminAccess() && !dataReady()) {

        supplyProductsCount.textContent = "—";

        supplyPendingUnits.textContent = "—";

        supplyEstimatedCost.textContent = "—";

    } else {

        renderSummary();
    }

    renderSupplyTable();

    renderProviderTable();

    updateFormAccess();
}

// ========================================
// CARGAR DATOS EN TIEMPO REAL
// ========================================

function stopListeners() {

    unsubscribers.forEach(unsubscribe => {

        unsubscribe();
    });

    unsubscribers = [];
}

function clearCollection(name) {

    if (name === "productos") products = [];

    if (name === "solicitudes") requests = [];

    if (name === "proveedores") providers = [];

    if (name === "compras") purchases = [];
}

function listenCollection(name, callback, revision) {

    const unsubscribe = onSnapshot(

        collection(db, name),

        snapshot => {

            if (!validSession(revision)) return;

            const data = snapshot.docs.map(item => ({

                ...item.data(),

                id: item.id
            }));

            callback(data);

            loaded.add(name);

            renderAll();
        },

        error => {

            if (!validSession(revision)) return;

            console.error(
                `Error en ${name}:`,
                error
            );

            loaded.delete(name);

            clearCollection(name);

            renderAll();

            showMessage(

                supplyMessage,

                `No se pudo consultar ${name}. Revisa Firebase.`,

                "error"
            );
        }
    );

    unsubscribers.push(unsubscribe);
}

function startListeners(revision) {

    listenCollection(

        "productos",

        data => {

            products = data.sort((a, b) =>

                String(a.name || "").localeCompare(
                    String(b.name || ""),
                    "es"
                )
            );
        },

        revision
    );

    listenCollection(

        "solicitudes",

        data => {

            requests = data;
        },

        revision
    );

    listenCollection(

        "proveedores",

        data => {

            providers = data.sort((a, b) =>

                String(a.name || "").localeCompare(
                    String(b.name || ""),
                    "es"
                )
            );
        },

        revision
    );

    listenCollection(

        "compras",

        data => {

            purchases = data;
        },

        revision
    );
}

// ========================================
// CAMBIO DE USUARIO Y ROL
// ========================================

window.addEventListener(

    "firebase-role-changed",

    event => {

        const revision =
            ++sessionRevision;

        stopListeners();

        currentUser =
            event.detail?.user || null;

        isAdmin =
            event.detail?.isAdmin === true;

        products = [];

        requests = [];

        providers = [];

        purchases = [];

        busy = false;

        loaded.clear();

        supplySearch.value = "";

        resetSupplyForm();

        resetProviderForm();

        showMessage(supplyFormMessage, "");

        showMessage(providerMessage, "");

        showMessage(supplyMessage, "");

        renderAll();

        if (hasAdminAccess()) {

            showMessage(

                supplyMessage,

                "Cargando información de Proveeduría..."
            );

            startListeners(revision);

        } else {

            showMessage(

                supplyMessage,

                "Conecta una cuenta administradora."
            );
        }
    }
);

// ========================================
// GUARDAR PROVEEDOR
// ========================================

providerForm?.addEventListener(

    "submit",

    async event => {

        event.preventDefault();

        if (!canOperate()) return;

        const revision = sessionRevision;

        const uid = currentUser.uid;

        const editingId = providerId.value;

        const name = providerName.value.trim();

        const location = providerLocation.value.trim();

        const phone = providerPhone.value.trim();

        const rawLink = providerLink.value.trim();

        const notes = providerNotes.value.trim();

        const link = safeURL(rawLink);

        if (!name) {

            showMessage(

                providerMessage,

                "Ingresa el nombre del proveedor.",

                "error"
            );

            return;
        }

        if (rawLink && !link) {

            showMessage(

                providerMessage,

                "Ingresa un enlace válido que comience con https:// o http://.",

                "error"
            );

            return;
        }

        if (editingId && !getProvider(editingId)) {

            showMessage(

                providerMessage,

                "El proveedor ya no existe.",

                "error"
            );

            return;
        }

        setBusy(true);

        saveProviderButton.textContent =
            "Guardando...";

        try {

            const data = {

                name,

                location,

                phone,

                link,

                notes,

                updatedAt: serverTimestamp(),

                updatedBy: uid
            };

            if (editingId) {

                await updateDoc(

                    doc(db, "proveedores", editingId),

                    data
                );

            } else {

                await addDoc(

                    collection(db, "proveedores"),

                    {

                        ...data,

                        createdAt: serverTimestamp(),

                        createdBy: uid
                    }
                );
            }

            if (!validSession(revision)) return;

            resetProviderForm();

            showMessage(

                providerMessage,

                "Proveedor guardado correctamente.",

                "success"
            );

        } catch (error) {

            if (!validSession(revision)) return;

            console.error(error);

            showMessage(

                providerMessage,

                `Error al guardar: ${error.message}`,

                "error"
            );

        } finally {

            if (validSession(revision)) {

                saveProviderButton.textContent =

                    providerId.value

                        ? "Actualizar proveedor"

                        : "Guardar proveedor";

                setBusy(false);
            }
        }
    }
);

// ========================================
// EDITAR Y ELIMINAR PROVEEDORES
// ========================================

providerTable?.addEventListener(

    "click",

    async event => {

        if (!canOperate()) return;

        const editButton =

            event.target.closest(
                "[data-edit-provider]"
            );

        const deleteButton =

            event.target.closest(
                "[data-delete-provider]"
            );

        if (editButton) {

            const provider = getProvider(

                editButton.dataset.editProvider
            );

            if (!provider) return;

            providerId.value =
                provider.id;

            providerName.value =
                provider.name || "";

            providerLocation.value =
                provider.location || "";

            providerPhone.value =
                provider.phone || "";

            providerLink.value =
                provider.link || "";

            providerNotes.value =
                provider.notes || "";

            saveProviderButton.textContent =
                "Actualizar proveedor";

            providerForm.scrollIntoView({

                behavior: "smooth",

                block: "start"
            });

            return;
        }

        if (!deleteButton) return;

        const id =
            deleteButton.dataset.deleteProvider;

        const provider =
            getProvider(id);

        if (!provider) return;

        const inUse = purchases.some(

            purchase =>
                purchase.providerId === id
        );

        if (inUse) {

            alert(

                "Este proveedor está asociado a una compra. Cambia primero el proveedor de ese material."
            );

            return;
        }

        if (!confirm(

            `¿Eliminar al proveedor "${provider.name}"?`

        )) return;

        const revision = sessionRevision;

        setBusy(true);

        try {

            await deleteDoc(

                doc(db, "proveedores", id)
            );

            if (!validSession(revision)) return;

            if (providerId.value === id) {

                resetProviderForm();
            }

            showMessage(

                providerMessage,

                "Proveedor eliminado correctamente.",

                "success"
            );

        } catch (error) {

            if (!validSession(revision)) return;

            showMessage(

                providerMessage,

                `Error al eliminar: ${error.message}`,

                "error"
            );

        } finally {

            if (validSession(revision)) {

                setBusy(false);
            }
        }
    }
);

// ========================================
// CARGAR DATOS DE COMPRA
// ========================================

function loadPurchaseForm() {

    if (!hasAdminAccess()) return;

    const product =
        getProduct(supplyProduct.value);

    const purchase =
        getPurchase(supplyProduct.value);

    supplyProvider.value =
        purchase?.providerId || "";

    supplyUnitPrice.value =
        purchase?.unitPrice ?? "";

    supplyPurchaseQuantity.value =
        purchase?.additionalQuantity ?? 0;

    supplyPurchaseNotes.value =
        purchase?.notes || "";

    // Comprado funciona como una acción:
    // registrar una nueva compra.

    supplyPurchaseStatus.value =
        "Pendiente";

    if (!product) {

        showMessage(supplyFormMessage, "");

        return;
    }

    if (isLegacyPurchase(purchase)) {

        showMessage(

            supplyFormMessage,

            "Revisa primero la compra anterior desde la tabla.",

            "error"
        );

        return;
    }

    const calculation =
        calculatePurchase(product, purchase);

    showMessage(

        supplyFormMessage,

        `Por comprar: ${calculation.toBuy}. Por recibir: ${calculation.ordered}. Estado actual: ${calculation.status}.`
    );
}

supplyProduct?.addEventListener(

    "change",

    loadPurchaseForm
);

// ========================================
// GUARDAR PLANIFICACIÓN O NUEVA COMPRA
// ========================================

supplyForm?.addEventListener(

    "submit",

    async event => {

        event.preventDefault();

        if (!canOperate()) return;

        const productId =
            supplyProduct.value;

        const selectedProvider =
            supplyProvider.value;

        const rawPrice =
            supplyUnitPrice.value.trim();

        const rawQuantity =
            supplyPurchaseQuantity.value.trim();

        const price = Number(rawPrice);

        const quantity = Number(rawQuantity);

        const status =
            supplyPurchaseStatus.value;

        const notes =
            supplyPurchaseNotes.value.trim();

        const product =
            getProduct(productId);

        const purchase =
            getPurchase(productId);

        if (!product) {

            showMessage(

                supplyFormMessage,

                "Selecciona un producto válido.",

                "error"
            );

            return;
        }

        if (!getProvider(selectedProvider)) {

            showMessage(

                supplyFormMessage,

                "Selecciona un proveedor válido.",

                "error"
            );

            return;
        }

        if (

            rawPrice === "" ||

            !Number.isFinite(price) ||

            price < 0

        ) {

            showMessage(

                supplyFormMessage,

                "Ingresa un precio válido.",

                "error"
            );

            return;
        }

        if (

            rawQuantity === "" ||

            !Number.isSafeInteger(quantity) ||

            quantity < 0

        ) {

            showMessage(

                supplyFormMessage,

                "La cantidad adicional debe ser un número entero igual o mayor que cero.",

                "error"
            );

            return;
        }

        const allowedStatuses = Array.from(

            supplyPurchaseStatus.options

        ).map(option => option.value)

            .filter(Boolean);

        if (!allowedStatuses.includes(status)) {

            showMessage(

                supplyFormMessage,

                "Selecciona un estado válido.",

                "error"
            );

            return;
        }

        if (isLegacyPurchase(purchase)) {

            showMessage(

                supplyFormMessage,

                "Debes revisar la compra anterior antes de continuar.",

                "error"
            );

            return;
        }

        const registeringPurchase =
            status === "Comprado";

        const preview = calculatePurchase(

            product,

            {

                ...purchase,

                unitPrice: price,

                additionalQuantity: quantity
            }
        );

        if (registeringPurchase) {

            if (preview.toBuy <= 0) {

                showMessage(

                    supplyFormMessage,

                    "No hay nuevas unidades pendientes de comprar.",

                    "error"
                );

                return;
            }

            const confirmed = confirm(

                `¿Registrar la compra de ${preview.toBuy} unidades de "${product.name}" por ${money(preview.total)}?\n\nLas existencias se actualizarán cuando recibas el material.`
            );

            if (!confirmed) return;
        }

        const revision = sessionRevision;

        const uid = currentUser.uid;

        const pending = getPending(productId);

        setBusy(true);

        saveSupplyButton.textContent =
            "Guardando...";

        try {

            const productReference =
                doc(db, "productos", productId);

            const providerReference =
                doc(db, "proveedores", selectedProvider);

            const purchaseReference =
                doc(db, "compras", productId);

            await runTransaction(

                db,

                async transaction => {

                    const productSnapshot =
                        await transaction.get(
                            productReference
                        );

                    const providerSnapshot =
                        await transaction.get(
                            providerReference
                        );

                    const purchaseSnapshot =
                        await transaction.get(
                            purchaseReference
                        );

                    if (!validSession(revision)) {

                        throw new Error(
                            "La sesión cambió."
                        );
                    }

                    if (

                        !productSnapshot.exists() ||

                        !providerSnapshot.exists()

                    ) {

                        throw new Error(
                            "El producto o proveedor ya no existe."
                        );
                    }

                    const actualProduct = {

                        ...productSnapshot.data(),

                        id: productId
                    };

                    const previousPurchase =

                        purchaseSnapshot.exists()

                            ? purchaseSnapshot.data()

                            : {};

                    if (isLegacyPurchase(previousPurchase)) {

                        throw new Error(
                            "Debes revisar la compra antigua."
                        );
                    }

                    let ordered = integer(

                        previousPurchase.orderedQuantity
                    );

                    const previousAdditional = integer(

                        previousPurchase.additionalQuantity
                    );

                    if (

                        ordered > 0 &&

                        previousPurchase.providerId &&

                        previousPurchase.providerId !== selectedProvider

                    ) {

                        throw new Error(
                            "Recibe primero las compras pendientes antes de cambiar el proveedor."
                        );
                    }

                    if (

                        registeringPurchase &&

                        ordered > 0 &&

                        previousPurchase.unitPrice !== price

                    ) {

                        throw new Error(
                            "Recibe primero las unidades compradas antes de registrar una compra con otro precio."
                        );
                    }

                    if (

                        ordered > 0 &&

                        quantity < previousAdditional

                    ) {

                        throw new Error(
                            "No reduzcas la cantidad adicional mientras haya compras por recibir."
                        );
                    }

                    const planning = {

                        ...previousPurchase,

                        additionalQuantity: quantity,

                        orderedQuantity: ordered,

                        unitPrice: price
                    };

                    const calculation =
                        calculatePurchase(

                            actualProduct,

                            planning,

                            pending
                        );

                    if (registeringPurchase) {

                        if (

                            calculation.toBuy <= 0 ||

                            calculation.toBuy !== preview.toBuy

                        ) {

                            throw new Error(

                                "La cantidad por comprar cambió. Revisa los datos y vuelve a intentarlo."
                            );
                        }

                        ordered += calculation.toBuy;
                    }

                    if (!Number.isSafeInteger(ordered)) {

                        throw new Error(
                            "Cantidad comprada inválida."
                        );
                    }

                    const finalCalculation =
                        calculatePurchase(

                            actualProduct,

                            {

                                ...planning,

                                orderedQuantity: ordered
                            },

                            pending
                        );

                    transaction.set(

                        purchaseReference,

                        {

                            productId,

                            providerId: selectedProvider,

                            unitPrice: price,

                            additionalQuantity: quantity,

                            orderedQuantity: ordered,

                            status: finalCalculation.status,

                            notes,

                            updatedAt: serverTimestamp(),

                            updatedBy: uid,

                            ...(registeringPurchase ? {

                                lastPurchaseAt:
                                    serverTimestamp(),

                                lastPurchaseQuantity:
                                    calculation.toBuy

                            } : {})
                        },

                        { merge: true }
                    );
                }
            );

            if (!validSession(revision)) return;

            supplyPurchaseStatus.value =
                "Pendiente";

            showMessage(

                supplyFormMessage,

                registeringPurchase

                    ? "Compra registrada correctamente. Las unidades quedan pendientes de recibir."

                    : "Datos de compra guardados correctamente.",

                "success"
            );

        } catch (error) {

            if (!validSession(revision)) return;

            console.error(error);

            showMessage(

                supplyFormMessage,

                `Error al guardar: ${error.message}`,

                "error"
            );

        } finally {

            if (validSession(revision)) {

                saveSupplyButton.textContent =
                    "Guardar datos de compra";

                setBusy(false);
            }
        }
    }
);

// ========================================
// RECIBIR COMPRA
// ========================================

async function receivePurchase(productId) {

    if (!canOperate()) return;

    const product = getProduct(productId);

    const purchase = getPurchase(productId);

    if (

        !product ||

        !purchase ||

        isLegacyPurchase(purchase)

    ) return;

    const ordered =
        integer(purchase.orderedQuantity);

    if (ordered <= 0) return;

    const answer = prompt(

        `Producto: ${product.name}\n\nUnidades pendientes de recibir: ${ordered}\n\n¿Cuántas unidades recibiste?`,

        String(ordered)
    );

    if (answer === null) return;

    const received = Number(answer);

    if (

        answer.trim() === "" ||

        !Number.isSafeInteger(received) ||

        received <= 0 ||

        received > ordered

    ) {

        alert(
            "Ingresa una cantidad válida."
        );

        return;
    }

    if (!confirm(

        `¿Confirmar la recepción de ${received} unidades?\n\nEl inventario se actualizará automáticamente.`

    )) return;

    const revision = sessionRevision;

    const user = {

        uid: currentUser.uid,

        name: currentUser.displayName || "",

        email: currentUser.email || ""
    };

    const pending =
        getPending(productId);

    setBusy(true);

    try {

        const productReference =
            doc(db, "productos", productId);

        const purchaseReference =
            doc(db, "compras", productId);

        const movementReference =
            doc(collection(db, "movimientos"));

        await runTransaction(

            db,

            async transaction => {

                const productSnapshot =
                    await transaction.get(
                        productReference
                    );

                const purchaseSnapshot =
                    await transaction.get(
                        purchaseReference
                    );

                if (!validSession(revision)) {

                    throw new Error(
                        "La sesión cambió."
                    );
                }

                if (

                    !productSnapshot.exists() ||

                    !purchaseSnapshot.exists()

                ) {

                    throw new Error(
                        "El producto o la compra ya no existe."
                    );
                }

                const actualProduct =

                    productSnapshot.data();

                const actualPurchase =

                    purchaseSnapshot.data();

                const previousQuantity =

                    actualProduct.quantity;

                const previousOrdered =

                    actualPurchase.orderedQuantity;

                if (

                    !Number.isSafeInteger(previousQuantity) ||

                    previousQuantity < 0 ||

                    !Number.isSafeInteger(previousOrdered) ||

                    received > previousOrdered

                ) {

                    throw new Error(

                        "Las existencias o las compras pendientes cambiaron."
                    );
                }

                const newQuantity =

                    previousQuantity + received;

                if (!Number.isSafeInteger(newQuantity)) {

                    throw new Error(
                        "La cantidad resultante no es válida."
                    );
                }

                const remainingOrdered =

                    previousOrdered - received;

                const previousAdditional = integer(

                    actualPurchase.additionalQuantity
                );

                // Cubrir primero las solicitudes.
                // El excedente reduce la compra adicional.

                const shortage = Math.max(

                    0,

                    pending - previousQuantity
                );

                const receivedForAdditional = Math.max(

                    0,

                    received - shortage
                );

                const remainingAdditional = Math.max(

                    0,

                    previousAdditional -
                    receivedForAdditional
                );

                const finalCalculation =
                    calculatePurchase(

                        {

                            ...actualProduct,

                            id: productId,

                            quantity: newQuantity
                        },

                        {

                            ...actualPurchase,

                            additionalQuantity:
                                remainingAdditional,

                            orderedQuantity:
                                remainingOrdered
                        },

                        pending
                    );

                // ACTUALIZAR EXISTENCIAS

                transaction.update(

                    productReference,

                    {

                        quantity: newQuantity,

                        updatedAt: serverTimestamp()
                    }
                );

                // ACTUALIZAR COMPRA PENDIENTE

                transaction.update(

                    purchaseReference,

                    {

                        orderedQuantity:
                            remainingOrdered,

                        additionalQuantity:
                            remainingAdditional,

                        status:
                            finalCalculation.status,

                        lastReceivedQuantity:
                            received,

                        lastReceivedAt:
                            serverTimestamp(),

                        updatedAt:
                            serverTimestamp(),

                        updatedBy:
                            user.uid
                    }
                );

                // GUARDAR HISTORIAL DE ENTRADA

                transaction.set(

                    movementReference,

                    {

                        productId,

                        productName:
                            actualProduct.name || "",

                        productUnit:
                            actualProduct.unit || "",

                        type: "Entrada",

                        quantity: received,

                        difference: received,

                        previousQuantity,

                        newQuantity,

                        reason:
                            "Recepción de compra",

                        notes:
                            "Entrada registrada desde Proveeduría.",

                        purchaseId:
                            productId,

                        providerId:
                            actualPurchase.providerId || "",

                        unitPrice:
                            actualPurchase.unitPrice || 0,

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

        if (!validSession(revision)) return;

        if (supplyProduct.value === productId) {

            loadPurchaseForm();
        }

        showMessage(

            supplyFormMessage,

            `Se recibieron ${received} unidades. El inventario y el historial fueron actualizados.`,

            "success"
        );

    } catch (error) {

        if (!validSession(revision)) return;

        console.error(error);

        showMessage(

            supplyFormMessage,

            `Error al recibir la compra: ${error.message}`,

            "error"
        );

    } finally {

        if (validSession(revision)) {

            setBusy(false);
        }
    }
}

// ========================================
// REVISAR COMPRAS ANTIGUAS
// ========================================

async function reviewLegacyPurchase(productId) {

    if (!canOperate()) return;

    const product =
        getProduct(productId);

    const purchase =
        getPurchase(productId);

    if (

        !product ||

        !isLegacyPurchase(purchase)

    ) return;

    const answer = prompt(

        `Compra antigua de "${product.name}".\n\nEscribe la cantidad que ya compraste pero todavía NO has recibido.\n\nSi ya recibiste todo o nunca realizaste la compra, escribe 0.`,

        "0"
    );

    if (answer === null) return;

    const ordered = Number(answer);

    if (

        answer.trim() === "" ||

        !Number.isSafeInteger(ordered) ||

        ordered < 0

    ) {

        alert("Ingresa una cantidad válida.");

        return;
    }

    const additionalAnswer = prompt(

        "¿Cuántas unidades adicionales todavía necesitas, aparte de las solicitudes de docentes?",

        String(
            integer(purchase.additionalQuantity)
        )
    );

    if (additionalAnswer === null) return;

    const additional =
        Number(additionalAnswer);

    if (

        additionalAnswer.trim() === "" ||

        !Number.isSafeInteger(additional) ||

        additional < 0

    ) {

        alert("Ingresa una cantidad válida.");

        return;
    }

    const revision = sessionRevision;

    const uid = currentUser.uid;

    const pending =
        getPending(productId);

    setBusy(true);

    try {

        const purchaseReference =
            doc(db, "compras", productId);

        const productReference =
            doc(db, "productos", productId);

        await runTransaction(

            db,

            async transaction => {

                const snapshot =
                    await transaction.get(
                        purchaseReference
                    );

                const productSnapshot =
                    await transaction.get(
                        productReference
                    );

                if (!validSession(revision)) {

                    throw new Error(
                        "La sesión cambió."
                    );
                }

                if (

                    !snapshot.exists() ||

                    !productSnapshot.exists() ||

                    !isLegacyPurchase(snapshot.data())

                ) {

                    throw new Error(
                        "El registro cambió o ya fue revisado."
                    );
                }

                const calculation =
                    calculatePurchase(

                        {

                            ...productSnapshot.data(),

                            id: productId
                        },

                        {

                            ...snapshot.data(),

                            orderedQuantity: ordered,

                            additionalQuantity: additional
                        },

                        pending
                    );

                transaction.update(

                    purchaseReference,

                    {

                        orderedQuantity: ordered,

                        additionalQuantity: additional,

                        status: calculation.status,

                        migratedAt: serverTimestamp(),

                        updatedAt: serverTimestamp(),

                        updatedBy: uid
                    }
                );
            }
        );

        if (!validSession(revision)) return;

        showMessage(

            supplyFormMessage,

            "Compra anterior revisada correctamente.",

            "success"
        );

    } catch (error) {

        if (!validSession(revision)) return;

        showMessage(

            supplyFormMessage,

            `Error al revisar: ${error.message}`,

            "error"
        );

    } finally {

        if (validSession(revision)) {

            setBusy(false);
        }
    }
}

// ========================================
// BOTONES DE LA TABLA DE COMPRAS
// ========================================

supplyTable?.addEventListener(

    "click",

    async event => {

        if (!canOperate()) return;

        const editButton =
            event.target.closest(
                "[data-edit-purchase]"
            );

        const receiveButton =
            event.target.closest(
                "[data-receive-purchase]"
            );

        const reviewButton =
            event.target.closest(
                "[data-review-purchase]"
            );

        if (receiveButton) {

            await receivePurchase(

                receiveButton.dataset.receivePurchase
            );

            return;
        }

        if (reviewButton) {

            await reviewLegacyPurchase(

                reviewButton.dataset.reviewPurchase
            );

            return;
        }

        if (!editButton) return;

        const productId =
            editButton.dataset.editPurchase;

        if (!getProduct(productId)) return;

        supplyProduct.value =
            productId;

        loadPurchaseForm();

        supplyForm.scrollIntoView({

            behavior: "smooth",

            block: "start"
        });
    }
);

// ========================================
// BUSCADOR
// ========================================

supplySearch?.addEventListener(

    "input",

    renderSupplyTable
);

// ========================================
// ESTADO INICIAL
// ========================================

renderAll();

showMessage(

    supplyMessage,

    "Conecta una cuenta administradora."
);
