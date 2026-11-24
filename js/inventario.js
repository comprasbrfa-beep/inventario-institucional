
import { db } from "./firebase.js";

import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =====================================
// ELEMENTOS
// =====================================

const productModal = document.getElementById("productModal");
const productForm = document.getElementById("productForm");

const addProductBtn = document.getElementById("addProductBtn");
const closeModal = document.getElementById("closeModal");
const cancelProduct = document.getElementById("cancelProduct");

const searchProduct = document.getElementById("searchProduct");
const inventoryTable = document.getElementById("inventoryTable");

const productId = document.getElementById("productId");
const productName = document.getElementById("productName");
const productUnit = document.getElementById("productUnit");
const productQuantity = document.getElementById("productQuantity");
const productLocation = document.getElementById("productLocation");
const productNotes = document.getElementById("productNotes");

const modalTitle = document.getElementById("modalTitle");
const saveProductButton = document.getElementById("saveProductButton");

// =====================================
// ESTADO DEL MÓDULO
// =====================================

let products = [];
let unsubscribeProducts = null;
let currentUser = null;
let isAdmin = false;
let sessionRevision = 0;
let savingProduct = false;

const validUnits = [
    "Unidad 1",
    "Unidad 2",
    "Unidad 3",
    "Unidad 4",
    "Institucional"
];

const productsCollection = collection(db, "productos");

// =====================================
// COMPROBAR PERMISOS
// =====================================

function hasAdminAccess() {
    return currentUser !== null && isAdmin === true;
}

function requireAdmin() {

    if (!hasAdminAccess()) {

        alert(
            "No tienes permisos para administrar el inventario."
        );

        return false;
    }

    return true;
}

// =====================================
// MENSAJE EN TABLA
// =====================================

function showTableMessage(message) {

    inventoryTable.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.className = "empty-message";
    cell.textContent = message;

    row.appendChild(cell);
    inventoryTable.appendChild(row);
}

// =====================================
// CONEXIÓN Y CARGA DE PRODUCTOS
// =====================================

window.addEventListener("firebase-role-changed", event => {

    const revision = ++sessionRevision;
    const details = event.detail || {};

    currentUser = details.user || null;
    isAdmin = details.isAdmin === true;

    if (unsubscribeProducts) {
        unsubscribeProducts();
        unsubscribeProducts = null;
    }

    products = [];
    savingProduct = false;

    closeProductModal();

    saveProductButton.textContent = "Guardar producto";

    addProductBtn.disabled = !hasAdminAccess();
    saveProductButton.disabled = !hasAdminAccess();
    searchProduct.disabled = !hasAdminAccess();

    searchProduct.value = "";

    updateSummary();

    if (!currentUser) {

        showTableMessage(
            "Conecta tu cuenta de Google para consultar el inventario."
        );

        return;
    }

    if (!isAdmin) {

        showTableMessage(
            "No tienes permisos para administrar el inventario."
        );

        return;
    }

    showTableMessage("Cargando productos...");

    const productsQuery = query(
        productsCollection,
        orderBy("name")
    );

    unsubscribeProducts = onSnapshot(

        productsQuery,

        snapshot => {

            if (
                revision !== sessionRevision ||
                !hasAdminAccess()
            ) {
                return;
            }

            products = snapshot.docs.map(document => ({
                ...document.data(),
                id: document.id
            }));

            renderProducts();
        },

        error => {

            if (revision !== sessionRevision) return;

            console.error(
                "Error al cargar productos:",
                error
            );

            products = [];

            updateSummary();

            addProductBtn.disabled = true;

            showTableMessage(
                "No se pudo cargar el inventario. Revisa los permisos de Firestore."
            );
        }
    );
});

// =====================================
// ABRIR MODAL
// =====================================

function openModal() {

    if (!requireAdmin()) return;

    if (savingProduct) return;

    productForm.reset();
    productId.value = "";

    modalTitle.textContent = "Agregar producto";
    saveProductButton.textContent = "Guardar producto";
    saveProductButton.disabled = false;

    productModal.classList.add("show");

    productName.focus();
}

// =====================================
// CERRAR MODAL
// =====================================

function closeProductModal() {

    productModal.classList.remove("show");

    productForm.reset();
    productId.value = "";
}

addProductBtn.addEventListener("click", openModal);

closeModal.addEventListener(
    "click",
    closeProductModal
);

cancelProduct.addEventListener(
    "click",
    closeProductModal
);

productModal.addEventListener("click", event => {

    if (event.target === productModal) {
        closeProductModal();
    }
});

// =====================================
// GUARDAR PRODUCTO
// =====================================

productForm.addEventListener("submit", async event => {

    event.preventDefault();

    if (!requireAdmin()) return;

    if (savingProduct) return;

    const revision = sessionRevision;
    const user = currentUser;

    const name = productName.value.trim();
    const unit = productUnit.value;
    const quantity = Number(productQuantity.value);
    const location = productLocation.value.trim();
    const notes = productNotes.value.trim();

    if (!name || !unit || !location) {

        alert("Completa todos los campos obligatorios.");
        return;
    }

    // VALIDAR UNIDAD

    if (!validUnits.includes(unit)) {

        alert("Selecciona una unidad válida.");
        return;
    }

    // VALIDAR CANTIDAD

    if (
        productQuantity.value.trim() === "" ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0
    ) {

        alert(
            "La cantidad debe ser un número entero válido igual o mayor que cero."
        );

        return;
    }

    const editingId = productId.value;

    // VALIDAR PRODUCTOS DUPLICADOS

    const duplicate = products.some(product =>

        String(product.name || "")
            .trim()
            .toLowerCase() === name.toLowerCase()

        && product.id !== editingId
    );

    if (duplicate) {

        alert("Ya existe un producto con ese nombre.");
        return;
    }

    savingProduct = true;

    addProductBtn.disabled = true;
    saveProductButton.disabled = true;

    saveProductButton.textContent = "Guardando...";

    try {

        const productData = {
            name,
            unit,
            quantity,
            location,
            notes,
            updatedAt: serverTimestamp()
        };

        if (editingId) {

            const productReference = doc(
                db,
                "productos",
                editingId
            );

            await updateDoc(
                productReference,
                productData
            );

        } else {

            await addDoc(productsCollection, {

                ...productData,

                createdAt: serverTimestamp(),
                createdBy: user.uid,
                createdByEmail: user.email || ""

            });
        }

        if (revision === sessionRevision) {
            closeProductModal();
        }

    } catch (error) {

        console.error(
            "Error al guardar producto:",
            error
        );

        if (revision === sessionRevision) {

            alert(
                "No se pudo guardar el producto. Revisa tu conexión y los permisos de Firestore."
            );
        }

    } finally {

        if (revision === sessionRevision) {

            savingProduct = false;

            addProductBtn.disabled = !hasAdminAccess();
            saveProductButton.disabled = !hasAdminAccess();

            saveProductButton.textContent =
                productId.value
                    ? "Guardar cambios"
                    : "Guardar producto";
        }
    }
});

// =====================================
// MOSTRAR PRODUCTOS
// =====================================

function renderProducts() {

    if (!hasAdminAccess()) {

        inventoryTable.replaceChildren();
        return;
    }

    const search = searchProduct.value
        .toLowerCase()
        .trim();

    const filteredProducts = products.filter(product =>

        String(product.name || "")
            .toLowerCase()
            .includes(search)

        ||

        String(product.location || "")
            .toLowerCase()
            .includes(search)

        ||

        String(product.unit || "")
            .toLowerCase()
            .includes(search)
    );

    inventoryTable.replaceChildren();

    if (filteredProducts.length === 0) {

        showTableMessage(

            products.length === 0
                ? "No hay productos registrados."
                : "No se encontraron productos."

        );

    } else {

        filteredProducts.forEach(product => {

            const row = document.createElement("tr");

            const values = [
                product.name || "",
                product.unit || "",
                product.quantity ?? 0,
                product.location || ""
            ];

            values.forEach(value => {

                const cell = document.createElement("td");

                cell.textContent = value;

                row.appendChild(cell);
            });

            // ESTADO DEL PRODUCTO

            const statusCell = document.createElement("td");
            const statusBadge = document.createElement("span");

            const status = getStatus(
                Number(product.quantity) || 0
            );

            statusBadge.className =
                `stock-status ${status.className}`;

            statusBadge.textContent = status.text;

            statusCell.appendChild(statusBadge);
            row.appendChild(statusCell);

            // OBSERVACIONES

            const notesCell = document.createElement("td");

            notesCell.textContent =
                product.notes || "—";

            row.appendChild(notesCell);

            // ACCIONES

            const actionsCell = document.createElement("td");

            const editButton = document.createElement("button");

            editButton.className = "action-button";
            editButton.textContent = "Editar";

            editButton.addEventListener("click", () => {
                editProduct(product.id);
            });

            const deleteButton = document.createElement("button");

            deleteButton.className = "action-button delete";
            deleteButton.textContent = "Eliminar";

            deleteButton.addEventListener("click", () => {
                deleteProduct(product.id);
            });

            actionsCell.appendChild(editButton);
            actionsCell.appendChild(deleteButton);

            row.appendChild(actionsCell);

            inventoryTable.appendChild(row);
        });
    }

    updateSummary();
}

// =====================================
// ESTADO DEL PRODUCTO
// =====================================

function getStatus(quantity) {

    if (quantity <= 0) {

        return {
            text: "Sin existencias",
            className: "empty"
        };
    }

    if (quantity <= 10) {

        return {
            text: "Stock bajo",
            className: "low"
        };
    }

    return {
        text: "Disponible",
        className: "available"
    };
}

// =====================================
// EDITAR PRODUCTO
// =====================================

function editProduct(id) {

    if (!requireAdmin()) return;

    if (savingProduct) return;

    const product = products.find(
        item => item.id === id
    );

    if (!product) return;

    productId.value = product.id;
    productName.value = product.name || "";
    productUnit.value = product.unit || "";
    productQuantity.value = product.quantity ?? 0;
    productLocation.value = product.location || "";
    productNotes.value = product.notes || "";

    modalTitle.textContent = "Editar producto";

    saveProductButton.textContent = "Guardar cambios";
    saveProductButton.disabled = false;

    productModal.classList.add("show");

    productName.focus();
}

// =====================================
// ELIMINAR PRODUCTO
// =====================================

async function deleteProduct(id) {

    if (!requireAdmin()) return;

    if (savingProduct) return;

    const revision = sessionRevision;

    const product = products.find(
        item => item.id === id
    );

    if (!product) return;

    const confirmation = confirm(

        `¿Estás seguro de eliminar "${product.name}"?\n\n` +

        "Esta acción no se puede deshacer.\n" +

        "Si existen solicitudes pendientes de este producto, no podrán entregarse después de eliminarlo."

    );

    if (!confirmation) return;

    if (
        revision !== sessionRevision ||
        !hasAdminAccess()
    ) {
        return;
    }

    try {

        await deleteDoc(
            doc(db, "productos", id)
        );

    } catch (error) {

        console.error(
            "Error al eliminar producto:",
            error
        );

        if (revision === sessionRevision) {

            alert(
                "No fue posible eliminar el producto. Revisa los permisos de Firestore."
            );
        }
    }
}

// =====================================
// ACTUALIZAR INDICADORES
// =====================================

function updateSummary() {

    const totalProducts = products.length;

    const totalUnits = products.reduce(

        (total, product) =>
            total + (Number(product.quantity) || 0),

        0
    );

    const outOfStock = products.filter(

        product => Number(product.quantity) === 0

    ).length;

    const availableProducts = products.filter(

        product => Number(product.quantity) > 0

    ).length;

    const lowStock = products.filter(

        product =>
            Number(product.quantity) > 0 &&
            Number(product.quantity) <= 10

    ).length;

    document.getElementById("inventoryCount").textContent =
        totalProducts;

    document.getElementById("inventoryUnits").textContent =
        totalUnits;

    document.getElementById("outOfStock").textContent =
        outOfStock;

    document.getElementById("dashboardProducts").textContent =
        totalProducts;

    document.getElementById("dashboardAvailable").textContent =
        availableProducts;

    document.getElementById("dashboardLowStock").textContent =
        lowStock;
}

// =====================================
// BUSCADOR
// =====================================

searchProduct.addEventListener(
    "input",
    renderProducts
);

// =====================================
// ESTADO INICIAL
// =====================================

addProductBtn.disabled = true;
saveProductButton.disabled = true;
searchProduct.disabled = true;

showTableMessage(
    "Conecta tu cuenta de Google para consultar el inventario."
);
