
import { db, auth } from "./firebase.js";

import {
    collection,
    doc,
    getDocsFromServer,
    getDocFromServer,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==========================================
// ELEMENTOS DE IMPORTACIÓN
// ==========================================

const openImportButton =
    document.getElementById("openImportButton");

const closeImportButton =
    document.getElementById("closeImportButton");

const cancelImportButton =
    document.getElementById("cancelImportButton");

const importModal =
    document.getElementById("importModal");

const importFile =
    document.getElementById("importFile");

const importSheet =
    document.getElementById("importSheet");

const previewImportButton =
    document.getElementById("previewImportButton");

const importPreview =
    document.getElementById("importPreview");

const importTable =
    document.getElementById("importTable");

const importSummary =
    document.getElementById("importSummary");

const importMessage =
    document.getElementById("importMessage");

const saveImportButton =
    document.getElementById("saveImportButton");

// ==========================================
// VARIABLES
// ==========================================

let XLSX = null;
let workbook = null;
let importedProducts = [];
let existingNames = new Set();

let currentUser = null;
let isAdmin = false;
let busy = false;
let sessionRevision = 0;

// ==========================================
// FUNCIONES GENERALES
// ==========================================

function normalize(value) {
    return String(value ?? "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function normalizeHeader(value) {
    return normalize(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function cleanText(value) {
    return String(value ?? "").trim();
}

function validSession(revision = sessionRevision) {
    return (
        revision === sessionRevision &&
        isAdmin &&
        currentUser !== null &&
        auth.currentUser?.uid === currentUser.uid
    );
}

function setMessage(message, type = "") {
    importMessage.textContent = message;

    importMessage.style.color =
        type === "error"
            ? "#dc2626"
            : type === "success"
            ? "#16a34a"
            : "";
}

function parseQuantity(value) {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value >= 0
            ? value
            : null;
    }

    const text = cleanText(value);

    if (!/^\d+$/.test(text)) {
        return null;
    }

    const quantity = Number(text);

    return Number.isSafeInteger(quantity) && quantity >= 0
        ? quantity
        : null;
}

function setBusy(value) {
    busy = value;

    importFile.disabled = value;
    importSheet.disabled = value || !workbook;

    previewImportButton.disabled =
        value || !workbook || !importSheet.value;

    closeImportButton.disabled = value;
    cancelImportButton.disabled = value;

    refreshValidation();
}

// ==========================================
// CONTROL DE PERMISOS
// ==========================================

function updatePermissions() {
    const authorized = validSession();

    openImportButton.hidden = !authorized;
    openImportButton.disabled = !authorized;

    if (!authorized) {
        resetImport();

        importModal.classList.remove("active");
        importModal.style.display = "none";
        importModal.hidden = true;
    }
}

window.addEventListener(
    "firebase-role-changed",
    (event) => {
        sessionRevision++;

        const detail = event.detail || {};

        currentUser = detail.user || null;
        isAdmin = detail.isAdmin === true;

        busy = false;

        updatePermissions();
    }
);

window.addEventListener(
    "firebase-user-changed",
    (event) => {
        if (!event.detail) {
            sessionRevision++;

            currentUser = null;
            isAdmin = false;
            busy = false;

            updatePermissions();
        }
    }
);

async function verifyAdministrator() {
    if (!validSession()) {
        throw new Error(
            "No tienes permisos administrativos."
        );
    }

    const user = currentUser;

    if (!user.email || !user.emailVerified) {
        throw new Error(
            "La cuenta no tiene un correo verificado."
        );
    }

    const userReference = doc(
        db,
        "usuarios",
        user.email
    );

    const userSnapshot = await getDocFromServer(
        userReference
    );

    if (!userSnapshot.exists()) {
        throw new Error("Usuario no autorizado.");
    }

    const data = userSnapshot.data();

    if (
        data.active !== true ||
        data.role !== "admin"
    ) {
        throw new Error(
            "No tienes permisos para importar productos."
        );
    }
}

// ==========================================
// ABRIR Y CERRAR VENTANA
// ==========================================

function resetImport() {
    workbook = null;
    importedProducts = [];
    existingNames.clear();

    importFile.value = "";
    importFile.disabled = false;

    importSheet.replaceChildren(
        new Option(
            "Primero selecciona un archivo",
            ""
        )
    );

    importSheet.disabled = true;

    previewImportButton.disabled = true;
    saveImportButton.disabled = true;

    closeImportButton.disabled = false;
    cancelImportButton.disabled = false;

    importPreview.hidden = true;
    importPreview.style.display = "none";

    importTable.replaceChildren();
    importSummary.textContent = "";

    setMessage("");
}

function openImportModal() {
    if (!validSession() || busy) {
        return;
    }

    resetImport();

    importModal.hidden = false;
    importModal.classList.add("active");
    importModal.style.display = "flex";

    importFile.focus();
}

function closeImportModal() {
    if (busy) {
        return;
    }

    importModal.classList.remove("active");
    importModal.style.display = "none";
    importModal.hidden = true;

    resetImport();

    openImportButton.focus();
}

openImportButton.addEventListener(
    "click",
    openImportModal
);

closeImportButton.addEventListener(
    "click",
    closeImportModal
);

cancelImportButton.addEventListener(
    "click",
    closeImportModal
);

importModal.addEventListener(
    "click",
    (event) => {
        if (event.target === importModal) {
            closeImportModal();
        }
    }
);

document.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key === "Escape" &&
            !importModal.hidden &&
            !busy
        ) {
            closeImportModal();
        }
    }
);

// ==========================================
// CARGAR LIBRERÍA DE EXCEL
// ==========================================

async function loadExcelLibrary() {
    if (XLSX) {
        return XLSX;
    }

    XLSX = await import(
        "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
    );

    return XLSX;
}

// ==========================================
// LEER ARCHIVO EXCEL
// ==========================================

importFile.addEventListener(
    "change",
    async () => {
        if (!validSession() || busy) {
            return;
        }

        const revision = sessionRevision;

        workbook = null;
        importedProducts = [];

        importTable.replaceChildren();

        importPreview.hidden = true;
        importPreview.style.display = "none";

        importSummary.textContent = "";

        importSheet.replaceChildren(
            new Option("Seleccionar pestaña", "")
        );

        const file = importFile.files[0];

        if (!file) {
            setBusy(false);
            return;
        }

        if (!file.name.toLowerCase().endsWith(".xlsx")) {
            setMessage(
                "Selecciona un archivo .xlsx válido.",
                "error"
            );

            setBusy(false);
            return;
        }

        if (file.size > 15 * 1024 * 1024) {
            setMessage(
                "El archivo supera el límite de 15 MB.",
                "error"
            );

            setBusy(false);
            return;
        }

        setBusy(true);
        setMessage("Leyendo archivo Excel...");

        try {
            const library =
                await loadExcelLibrary();

            const buffer =
                await file.arrayBuffer();

            const loadedWorkbook =
                library.read(buffer, {
                    type: "array",
                    cellDates: false
                });

            if (!validSession(revision)) {
                return;
            }

            workbook = loadedWorkbook;

            for (const sheetName of workbook.SheetNames) {
                importSheet.add(
                    new Option(
                        sheetName,
                        sheetName
                    )
                );
            }

            const materialsSheet =
                workbook.SheetNames.find(
                    (name) =>
                        normalizeHeader(name) ===
                            "inventario de materiales" ||
                        normalizeHeader(name) ===
                            "materiales"
                );

            if (materialsSheet) {
                importSheet.value = materialsSheet;
            }

            setMessage(
                "Archivo cargado. Revisa la pestaña seleccionada.",
                "success"
            );

        } catch (error) {
            console.error(error);

            if (validSession(revision)) {
                workbook = null;

                setMessage(
                    "No fue posible leer el archivo Excel.",
                    "error"
                );
            }

        } finally {
            if (validSession(revision)) {
                setBusy(false);
            }
        }
    }
);

// ==========================================
// CAMBIO DE PESTAÑA
// ==========================================

importSheet.addEventListener(
    "change",
    () => {
        importedProducts = [];

        importTable.replaceChildren();

        importPreview.hidden = true;
        importPreview.style.display = "none";

        importSummary.textContent = "";

        setMessage("");

        setBusy(false);
    }
);

// ==========================================
// IDENTIFICAR COLUMNAS DEL EXCEL
// ==========================================

function findHeaders(rows) {
    const aliases = {
        name: [
            "nombre de producto",
            "nombre del producto",
            "producto",
            "material",
            "nombre del material"
        ],

        quantity: [
            "cantidad disponible",
            "cantidad",
            "existencias",
            "stock"
        ],

        location: [
            "ubicacion",
            "ubicacion / bodega",
            "ubicacion/almacen",
            "bodega",
            "almacen"
        ],

        notes: [
            "observaciones",
            "notas",
            "columna 5",
            "columna5"
        ]
    };

    for (
        let index = 0;
        index < Math.min(rows.length, 30);
        index++
    ) {
        const headers = rows[index].map(
            normalizeHeader
        );

        const columns = {};

        for (const key of Object.keys(aliases)) {
            columns[key] = headers.findIndex(
                (header) =>
                    aliases[key].includes(header)
            );
        }

        if (
            columns.name !== -1 &&
            columns.quantity !== -1
        ) {
            return {
                rowIndex: index,
                ...columns
            };
        }
    }

    throw new Error(
        "No se encontraron las columnas de producto y cantidad."
    );
}

// ==========================================
// CONSULTAR PRODUCTOS EXISTENTES
// ==========================================

async function loadExistingProducts() {
    const snapshot = await getDocsFromServer(
        collection(db, "productos")
    );

    const names = new Set();

    snapshot.forEach((document) => {
        names.add(
            normalize(document.data().name)
        );
    });

    return names;
}

// ==========================================
// GENERAR VISTA PREVIA
// ==========================================

previewImportButton.addEventListener(
    "click",
    async () => {
        if (
            !validSession() ||
            busy ||
            !workbook ||
            !importSheet.value
        ) {
            return;
        }

        const revision = sessionRevision;

        importedProducts = [];

        importTable.replaceChildren();

        importPreview.hidden = true;
        importPreview.style.display = "none";

        importSummary.textContent = "";

        setBusy(true);

        setMessage(
            "Revisando productos y duplicados..."
        );

        try {
            await verifyAdministrator();

            const names =
                await loadExistingProducts();

            if (!validSession(revision)) {
                return;
            }

            existingNames = names;

            const worksheet =
                workbook.Sheets[importSheet.value];

            if (!worksheet || !worksheet["!ref"]) {
                throw new Error(
                    "La pestaña seleccionada está vacía."
                );
            }

            const range =
                XLSX.utils.decode_range(
                    worksheet["!ref"]
                );

            if (
                range.e.r > 10000 ||
                range.e.c > 200
            ) {
                throw new Error(
                    "La pestaña excede el tamaño permitido."
                );
            }

            const rows =
                XLSX.utils.sheet_to_json(
                    worksheet,
                    {
                        header: 1,
                        range: {
                            s: { r: 0, c: 0 },
                            e: range.e
                        },
                        defval: "",
                        blankrows: true,
                        raw: true
                    }
                );

            const headers = findHeaders(rows);

            for (
                let index = headers.rowIndex + 1;
                index < rows.length;
                index++
            ) {
                const row = rows[index];

                if (
                    !row.some(
                        (value) =>
                            cleanText(value) !== ""
                    )
                ) {
                    continue;
                }

                const originalName =
                    row[headers.name];

                const name =
                    cleanText(originalName);

                const quantity =
                    cleanText(
                        row[headers.quantity]
                    );

                const location =
                    headers.location !== -1
                        ? cleanText(
                            row[headers.location]
                        )
                        : "";

                const notes =
                    headers.notes !== -1
                        ? cleanText(
                            row[headers.notes]
                        )
                        : "";

                importedProducts.push({
                    excelRow: index + 1,
                    name,
                    quantity,
                    location,
                    notes,
                    unit: "Institucional",
                    selected: true,
                    issues: []
                });
            }

            if (importedProducts.length === 0) {
                throw new Error(
                    "No se encontraron productos."
                );
            }

            if (importedProducts.length > 400) {
                importedProducts = [];

                throw new Error(
                    "Importa un máximo de 400 registros por archivo."
                );
            }

            validateProducts();

            // Los registros incorrectos empiezan
            // desmarcados para evitar importaciones
            // accidentales.

            importedProducts.forEach(
                (product) => {
                    if (product.issues.length > 0) {
                        product.selected = false;
                    }
                }
            );

            renderPreview();

            importPreview.hidden = false;
            importPreview.style.display = "block";

            setMessage(
                "Vista previa lista. Revisa y corrige los registros antes de importar.",
                "success"
            );

        } catch (error) {
            console.error(error);

            if (validSession(revision)) {
                setMessage(
                    error.message ||
                    "No se pudo revisar el Excel.",
                    "error"
                );
            }

        } finally {
            if (validSession(revision)) {
                setBusy(false);
            }
        }
    }
);

// ==========================================
// VALIDAR REGISTROS
// ==========================================

function validateProducts() {
    const nameCounts = new Map();

    importedProducts.forEach((product) => {
        if (!product.selected) {
            return;
        }

        const key = normalize(product.name);

        if (key) {
            nameCounts.set(
                key,
                (nameCounts.get(key) || 0) + 1
            );
        }
    });

    // Detectar duplicados en todo el Excel.

    const allNameCounts = new Map();

    importedProducts.forEach((product) => {
        const key = normalize(product.name);

        if (key) {
            allNameCounts.set(
                key,
                (allNameCounts.get(key) || 0) + 1
            );
        }
    });

    importedProducts.forEach((product) => {
        const issues = [];

        const name = cleanText(product.name);
        const key = normalize(name);

        if (!name || !/[a-záéíóúñü]/i.test(name)) {
            issues.push("Nombre inválido");
        }

        if (name.length > 250) {
            issues.push("Nombre demasiado largo");
        }

        if (
            parseQuantity(product.quantity) === null
        ) {
            issues.push("Cantidad inválida");
        }

        if (!cleanText(product.location)) {
            issues.push("Falta ubicación");
        }

        if (product.location.length > 500) {
            issues.push("Ubicación demasiado larga");
        }

        if (product.notes.length > 5000) {
            issues.push("Observación demasiado larga");
        }

        if (existingNames.has(key)) {
            issues.push("Ya existe en inventario");
        }

        const duplicateCount =
            product.selected
                ? nameCounts.get(key)
                : allNameCounts.get(key);

        if (key && duplicateCount > 1) {
            issues.push("Duplicado en Excel");
        }

        product.issues = issues;
    });
}

// ==========================================
// CREAR CAMPOS EDITABLES
// ==========================================

function createEditableInput(
    product,
    field,
    type = "text",
    maxLength = null
) {
    const input = document.createElement("input");

    input.type = type;
    input.value = product[field];
    input.disabled = busy;

    input.setAttribute(
        "aria-label",
        `${field}, fila ${product.excelRow}`
    );

    if (maxLength !== null) {
        input.maxLength = maxLength;
    }

    if (type === "number") {
        input.min = "0";
        input.step = "1";
    }

    input.style.width = "100%";
    input.style.minWidth = "100px";
    input.style.padding = "8px";

    input.addEventListener(
        "input",
        () => {
            if (busy || !validSession()) {
                return;
            }

            product[field] = input.value;

            refreshValidation();
        }
    );

    return input;
}

// ==========================================
// MOSTRAR TABLA DE VISTA PREVIA
// ==========================================

function renderPreview() {
    importTable.replaceChildren();

    const fragment =
        document.createDocumentFragment();

    importedProducts.forEach((product) => {
        const tr = document.createElement("tr");

        // Casilla de selección

        const checkbox =
            document.createElement("input");

        checkbox.type = "checkbox";
        checkbox.checked = product.selected;

        checkbox.setAttribute(
            "aria-label",
            `Importar fila ${product.excelRow}`
        );

        checkbox.addEventListener(
            "change",
            () => {
                product.selected =
                    checkbox.checked;

                refreshValidation();
            }
        );

        const selectCell =
            document.createElement("td");

        selectCell.appendChild(checkbox);

        // Número de fila

        const rowCell =
            document.createElement("td");

        rowCell.textContent =
            product.excelRow;

        // Producto

        const nameCell =
            document.createElement("td");

        nameCell.appendChild(
            createEditableInput(
                product,
                "name",
                "text",
                250
            )
        );

        // Cantidad

        const quantityCell =
            document.createElement("td");

        quantityCell.appendChild(
            createEditableInput(
                product,
                "quantity"
            )
        );

        // Ubicación

        const locationCell =
            document.createElement("td");

        locationCell.appendChild(
            createEditableInput(
                product,
                "location",
                "text",
                500
            )
        );

        // Observaciones

        const notesCell =
            document.createElement("td");

        notesCell.appendChild(
            createEditableInput(
                product,
                "notes",
                "text",
                5000
            )
        );

        // Estado

        const statusCell =
            document.createElement("td");

        product.statusElement = statusCell;

        tr.append(
            selectCell,
            rowCell,
            nameCell,
            quantityCell,
            locationCell,
            notesCell,
            statusCell
        );

        fragment.appendChild(tr);
    });

    importTable.appendChild(fragment);

    refreshValidation();
}

// ==========================================
// ACTUALIZAR ESTADOS Y RESUMEN
// ==========================================

function refreshValidation() {
    validateProducts();

    let ready = 0;
    let invalid = 0;
    let selected = 0;
    let selectedInvalid = 0;

    importedProducts.forEach((product) => {
        const hasIssues =
            product.issues.length > 0;

        if (hasIssues) {
            invalid++;
        } else {
            ready++;
        }

        if (product.selected) {
            selected++;

            if (hasIssues) {
                selectedInvalid++;
            }
        }

        if (product.statusElement) {
            product.statusElement.textContent =
                hasIssues
                    ? product.issues.join(" · ")
                    : "Listo para importar";

            product.statusElement.style.color =
                hasIssues
                    ? "#dc2626"
                    : "#16a34a";

            product.statusElement.style.fontWeight =
                "600";
        }
    });

    if (importedProducts.length > 0) {
        importSummary.textContent =
            `Total: ${importedProducts.length} | ` +
            `Válidos: ${ready} | ` +
            `Por revisar: ${invalid} | ` +
            `Seleccionados: ${selected}`;
    }

    importTable
        .querySelectorAll("input")
        .forEach((input) => {
            input.disabled = busy;
        });

    saveImportButton.disabled =
        busy ||
        !validSession() ||
        selected === 0 ||
        selectedInvalid > 0;
}

// ==========================================
// GENERAR IDENTIFICADOR DE IMPORTACIÓN
// ==========================================

async function generateProductId(name) {
    const key = normalize(name);

    const bytes =
        new TextEncoder().encode(key);

    const hash =
        await crypto.subtle.digest(
            "SHA-256",
            bytes
        );

    const hexadecimal =
        Array.from(new Uint8Array(hash))
            .map(
                (byte) =>
                    byte.toString(16)
                        .padStart(2, "0")
            )
            .join("");

    return `import_${hexadecimal}`;
}

// ==========================================
// IMPORTAR PRODUCTOS A FIREBASE
// ==========================================

saveImportButton.addEventListener(
    "click",
    async () => {
        if (!validSession() || busy) {
            return;
        }

        refreshValidation();

        const selectedProducts =
            importedProducts.filter(
                (product) => product.selected
            );

        if (selectedProducts.length === 0) {
            setMessage(
                "Selecciona al menos un producto.",
                "error"
            );

            return;
        }

        if (
            selectedProducts.some(
                (product) =>
                    product.issues.length > 0
            )
        ) {
            setMessage(
                "Corrige los productos seleccionados.",
                "error"
            );

            return;
        }

        const confirmed = window.confirm(
            `¿Deseas importar ${selectedProducts.length} ` +
            "productos al inventario real de la institución?\n\n" +
            "Todos se registrarán como Institucional."
        );

        if (!confirmed) {
            return;
        }

        const revision = sessionRevision;
        const user = currentUser;

        setBusy(true);

        setMessage(
            "Verificando permisos y guardando productos..."
        );

        try {
            await verifyAdministrator();

            const names =
                await loadExistingProducts();

            if (!validSession(revision)) {
                return;
            }

            existingNames = names;

            validateProducts();

            if (
                selectedProducts.some(
                    (product) =>
                        product.issues.length > 0
                )
            ) {
                throw new Error(
                    "Se detectaron nuevos conflictos. Revisa la tabla."
                );
            }

            const records = [];

            for (const product of selectedProducts) {
                const id =
                    await generateProductId(
                        product.name
                    );

                records.push({
                    reference: doc(
                        db,
                        "productos",
                        id
                    ),

                    data: {
                        name: cleanText(
                            product.name
                        ),

                        unit: "Institucional",

                        quantity: parseQuantity(
                            product.quantity
                        ),

                        location: cleanText(
                            product.location
                        ),

                        notes: cleanText(
                            product.notes
                        ),

                        createdBy: user.uid,
                        createdByEmail: user.email
                    }
                });
            }

            if (!validSession(revision)) {
                return;
            }

            // La transacción evita sobrescribir
            // productos con el mismo identificador.
            // Todos se guardan juntos o ninguno.

            await runTransaction(
                db,
                async (transaction) => {
                    if (!validSession(revision)) {
                        throw new Error(
                            "La sesión cambió."
                        );
                    }

                    // Primero realizar todas las lecturas.

                    for (const record of records) {
                        const snapshot =
                            await transaction.get(
                                record.reference
                            );

                        if (snapshot.exists()) {
                            throw new Error(
                                `El producto ${record.data.name} ya existe.`
                            );
                        }
                    }

                    // Después realizar las escrituras.

                    for (const record of records) {
                        transaction.set(
                            record.reference,
                            {
                                ...record.data,

                                createdAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()
                            }
                        );
                    }
                }
            );

            if (!validSession(revision)) {
                return;
            }

            const savedCount = records.length;

            resetImport();

            setMessage(
                `¡Importación exitosa! Se registraron ` +
                `${savedCount} productos en el inventario.`,
                "success"
            );

            importSummary.textContent =
                `${savedCount} productos guardados correctamente.`;

        } catch (error) {
            console.error(
                "Error de importación:",
                error
            );

            if (validSession(revision)) {
                setMessage(
                    "No se pudo confirmar la importación. " +
                    (error.message || "") +
                    " Revisa el inventario antes de reintentar.",
                    "error"
                );
            }

        } finally {
            if (validSession(revision)) {
                setBusy(false);
            }
        }
    }
);

// ==========================================
// ESTADO INICIAL
// ==========================================

resetImport();
updatePermissions();
