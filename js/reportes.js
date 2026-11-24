
import { db } from "./firebase.js";

import {
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ========================================
// ELEMENTOS HTML
// ========================================

const $ = id => document.getElementById(id);

const reportProducts = $("reportProducts");
const reportRequests = $("reportRequests");
const reportMovements = $("reportMovements");
const reportPurchaseCost = $("reportPurchaseCost");

const reportType = $("reportType");
const reportUnit = $("reportUnit");
const reportStartDate = $("reportStartDate");
const reportEndDate = $("reportEndDate");
const reportMessage = $("reportMessage");

const generateReportButton = $("generateReportButton");
const printReportButton = $("printReportButton");

const reportResultsTitle = $("reportResultsTitle");
const reportResultsDescription = $("reportResultsDescription");

const reportResultCount = $("reportResultCount");
const reportResultUnits = $("reportResultUnits");
const reportResultValue = $("reportResultValue");

const reportTableHead = $("reportTableHead");
const reportTableBody = $("reportTableBody");

// ========================================
// ESTADO DEL MÓDULO
// ========================================

let products = [];
let requests = [];
let movements = [];
let purchases = [];
let providers = [];

let currentUser = null;
let isAdmin = false;

let sessionRevision = 0;

let unsubscribers = [];

let generatedReport = null;

let printWindow = null;

const loaded = new Set();

const collectionErrors = new Set();

const requiredCollections = [

    "productos",

    "solicitudes",

    "movimientos",

    "compras",

    "proveedores"

];

const validTypes = [

    "inventario",

    "solicitudes",

    "movimientos",

    "compras"

];

const TIME_ZONE = "America/Costa_Rica";

// ========================================
// CONTROL DE PERMISOS
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

    ) && collectionErrors.size === 0;
}

// ========================================
// UTILIDADES
// ========================================

const currencyFormatter =
    new Intl.NumberFormat("es-CR", {

        style: "currency",

        currency: "CRC",

        maximumFractionDigits: 2

    });

function money(value) {

    return Number.isFinite(value)

        ? currencyFormatter.format(value)

        : "No disponible";
}

function number(value) {

    const result = Number(value);

    return Number.isFinite(result) &&
        result >= 0
        ? result
        : 0;
}

function integer(value) {

    const result = Number(value);

    return Number.isSafeInteger(result) &&
        result >= 0
        ? result
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

function showMessage(message, error = false) {

    reportMessage.textContent = message;

    reportMessage.style.color =

        error
            ? "#dc2626"
            : "#16a34a";
}

// ========================================
// CONTROL DE BOTONES Y FILTROS
// ========================================

function updateFormAccess() {

    const enabled =
        hasAdminAccess() &&
        dataReady();

    reportType.disabled = !enabled;

    reportUnit.disabled = !enabled;

    const usesDates = [

        "solicitudes",

        "movimientos"

    ].includes(reportType.value);

    reportStartDate.disabled =
        !enabled || !usesDates;

    reportEndDate.disabled =
        !enabled || !usesDates;

    generateReportButton.disabled =
        !enabled;

    printReportButton.disabled =

        !enabled ||
        !generatedReport;
}

// ========================================
// FECHAS DE COSTA RICA
// ========================================

function getDate(value) {

    if (value === null || value === undefined) {

        return null;
    }

    try {

        let date;

        if (typeof value.toDate === "function") {

            date = value.toDate();

        } else if (

            typeof value === "string" ||

            typeof value === "number"

        ) {

            date = new Date(value);

        } else {

            return null;
        }

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

            timeZone: TIME_ZONE,

            day: "2-digit",

            month: "2-digit",

            year: "numeric"

        }
    );
}

function dateKey(value) {

    const date = getDate(value);

    if (!date) return "";

    const parts = new Intl.DateTimeFormat(

        "en-CA",

        {

            timeZone: TIME_ZONE,

            year: "numeric",

            month: "2-digit",

            day: "2-digit"

        }

    ).formatToParts(date);

    const year = parts.find(

        item => item.type === "year"

    )?.value;

    const month = parts.find(

        item => item.type === "month"

    )?.value;

    const day = parts.find(

        item => item.type === "day"

    )?.value;

    return `${year}-${month}-${day}`;
}

function formatCurrentDate() {

    return new Date().toLocaleString(

        "es-CR",

        {

            timeZone: TIME_ZONE,

            day: "2-digit",

            month: "2-digit",

            year: "numeric",

            hour: "2-digit",

            minute: "2-digit"

        }
    );
}

// ========================================
// FILTROS POR FECHA
// ========================================

function matchesDate(item) {

    const start =
        reportStartDate.value;

    const end =
        reportEndDate.value;

    if (!start && !end) return true;

    const day = dateKey(

        item.createdAt ??
        item.date ??
        item.updatedAt
    );

    if (!day) return false;

    return (

        (!start || day >= start) &&

        (!end || day <= end)

    );
}

// ========================================
// FILTROS POR UNIDAD
// ========================================

function matchesUnit(item, type) {

    const selectedUnit =
        reportUnit.value;

    if (

        !selectedUnit ||

        selectedUnit.toLowerCase() === "todas"

    ) {

        return true;
    }

    const unit =

        type === "movimientos"

            ? item.productUnit ??
              item.unit ??
              ""

            : item.unit ?? "";

    return unit === selectedUnit;
}

// ========================================
// ORDENAR POR FECHA
// ========================================

function sortByRecent(items) {

    return [...items].sort((a, b) => {

        const dateA = getDate(

            a.createdAt ??
            a.date ??
            a.updatedAt

        )?.getTime() ?? 0;

        const dateB = getDate(

            b.createdAt ??
            b.date ??
            b.updatedAt

        )?.getTime() ?? 0;

        return dateB - dateA;
    });
}

function sortByName(items) {

    return [...items].sort((a, b) =>

        String(a.name || "").localeCompare(

            String(b.name || ""),

            "es"
        )
    );
}

// ========================================
// COMPRAS Y PROVEEDURÍA
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

function getPurchase(productId) {

    return purchases.find(

        purchase => purchase.id === productId

    );
}

function getProvider(providerId) {

    return providers.find(

        provider => provider.id === providerId

    );
}

// ========================================
// DETECTAR COMPRAS ANTIGUAS
// ========================================

function isLegacyPurchase(purchase) {

    return purchase?.status === "Comprado" &&

        !Number.isSafeInteger(

            purchase.orderedQuantity
        );
}

// ========================================
// NUEVO CÁLCULO DE COMPRAS
// ========================================

function calculatePurchase(product, purchase) {

    const available =
        integer(product.quantity);

    const pending =
        getPending(product.id);

    const additional =
        integer(purchase?.additionalQuantity);

    const ordered =
        integer(purchase?.orderedQuantity);

    const shortage = Math.max(

        0,

        pending - available
    );

    const required =
        shortage + additional;

    const toBuy = Math.max(

        0,

        required - ordered
    );

    const price =
        number(purchase?.unitPrice);

    const total =
        toBuy * price;

    const legacy =
        isLegacyPurchase(purchase);

    let status = "Pendiente";

    if (legacy) {

        status =
            "Revisar compra anterior";

    } else if (toBuy > 0) {

        status =
            "Pendiente";

    } else if (ordered > 0) {

        status =
            "Comprado";

    } else if (required === 0) {

        status =
            "Sin compra pendiente";
    }

    return {

        available,

        pending,

        additional,

        ordered,

        required,

        toBuy,

        price,

        total,

        status,

        legacy
    };
}

// ========================================
// COSTO TOTAL PENDIENTE
// ========================================

function getPendingPurchaseCost() {

    let total = 0;

    let legacyCount = 0;

    let unpricedCount = 0;

    products.forEach(product => {

        const purchase =
            getPurchase(product.id);

        const calculation =
            calculatePurchase(
                product,
                purchase
            );

        if (calculation.legacy) {

            legacyCount++;

            return;
        }

        if (

            calculation.toBuy > 0 &&

            (

                !purchase ||

                typeof purchase.unitPrice !== "number" ||

                !Number.isFinite(purchase.unitPrice) ||

                purchase.unitPrice < 0

            )

        ) {

            unpricedCount++;

            return;
        }

        total += calculation.total;
    });

    return {

        total,

        legacyCount,

        unpricedCount
    };
}

// ========================================
// INDICADORES GENERALES
// ========================================
// ========================================
// AGRUPAR PEDIDOS DOCENTES
// ========================================

function groupOrders(items) {

    const groups = new Map();

    items.forEach(request => {

        const hasOrderId =
            typeof request.orderId === "string" &&
            request.orderId.length > 0;

        const orderId = hasOrderId
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

                teacher:
                    request.teacherName ||
                    request.teacherEmail ||
                    "Sin docente",

                email:
                    request.teacherEmail || "",

                unit:
                    request.unit || "—",

                createdAt:
                    request.createdAt ??
                    request.date,

                generalNotes:
                    request.generalNotes || "",

                items: [],

                requested: 0,

                delivered: 0,

                pending: 0,

                status: "Pendiente",

                validData: true

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

        order.requested += integer(requested);

        order.delivered += integer(delivered);

        order.pending += integer(pending);

        if (

            !Number.isSafeInteger(requested) ||

            requested <= 0 ||

            !Number.isSafeInteger(delivered) ||

            delivered < 0 ||

            !Number.isSafeInteger(pending) ||

            pending < 0 ||

            requested - delivered !== pending

        ) {

            order.validData = false;

        }

        const previousDate =
            getDate(order.createdAt);

        const currentDate =
            getDate(
                request.createdAt ??
                request.date
            );

        if (

            currentDate &&

            (
                !previousDate ||
                currentDate < previousDate
            )

        ) {

            order.createdAt =
                request.createdAt ??
                request.date;

        }

    });

    const orders =
        Array.from(groups.values());

    orders.forEach(order => {

        if (!order.validData) {

            order.status = "Revisar";

        } else if (order.pending === 0) {

            order.status = "Entregada";

        } else if (order.delivered > 0) {

            order.status = "Parcial";

        } else {

            order.status = "Pendiente";

        }

        order.items.sort((a, b) =>

            String(a.productName || "")
                .localeCompare(
                    String(b.productName || ""),
                    "es"
                )

        );

    });

    return sortByRecent(orders);

}
function renderSummary() {

    if (!hasAdminAccess()) {

        reportProducts.textContent = "0";

        reportRequests.textContent = "0";

        reportMovements.textContent = "0";

        reportPurchaseCost.textContent =
            money(0);

        return;
    }

    reportProducts.textContent =

        loaded.has("productos")

            ? products.length

            : "—";

    reportRequests.textContent =

        loaded.has("solicitudes")

            ? groupOrders(requests).length

            : "—";

    reportMovements.textContent =

        loaded.has("movimientos")

            ? movements.length

            : "—";

    if (!dataReady()) {

        reportPurchaseCost.textContent = "—";

        reportPurchaseCost.removeAttribute(
            "title"
        );

        return;
    }

    const result =
        getPendingPurchaseCost();

    const incomplete =

        result.legacyCount > 0 ||

        result.unpricedCount > 0;

    reportPurchaseCost.textContent =

        money(result.total) +

        (incomplete ? " *" : "");

    reportPurchaseCost.title = incomplete

        ? "Costo parcial: hay compras antiguas o materiales sin precio."

        : "Costo estimado pendiente de compra.";
}

// ========================================
// CONSTRUIR TABLAS SEGURAS
// ========================================

function createCell(row, value, tag = "td") {

    const cell =
        document.createElement(tag);

    cell.textContent =
        String(value ?? "");

    row.appendChild(cell);
}

function renderTable(headers, rows, message) {

    reportTableHead.replaceChildren();

    reportTableBody.replaceChildren();

    const headerRow =
        document.createElement("tr");

    headers.forEach(header => {

        createCell(

            headerRow,

            header,

            "th"
        );
    });

    reportTableHead.appendChild(headerRow);

    if (!rows.length) {

        const row =
            document.createElement("tr");

        const cell =
            document.createElement("td");

        cell.colSpan =
            Math.max(1, headers.length);

        cell.className =
            "empty-message";

        cell.textContent =

            message ||

            "No se encontraron registros.";

        row.appendChild(cell);

        reportTableBody.appendChild(row);

        return;
    }

    rows.forEach(values => {

        const row =
            document.createElement("tr");

        values.forEach(value => {

            createCell(row, value);
        });

        reportTableBody.appendChild(row);
    });
}

// ========================================
// LIMPIAR REPORTE
// ========================================

function clearReport(message) {

    generatedReport = null;

    printReportButton.disabled = true;

    reportResultsTitle.textContent =
        "Resultados del reporte";

    reportResultsDescription.textContent =

        message ||

        "Selecciona los filtros y genera un reporte.";

    reportResultCount.textContent = "0";

    reportResultUnits.textContent = "0";

    reportResultValue.textContent = "—";

    renderTable(

        [
            "Información",
            "Detalle",
            "Estado"
        ],

        [],

        message ||
        "Todavía no se ha generado un reporte."
    );

    updateFormAccess();
}

// ========================================
// GENERAR REPORTE
// ========================================

function generateReport() {

    if (!hasAdminAccess()) {

        clearReport("No tienes permisos.");

        showMessage(

            "Solo administración puede generar reportes.",

            true
        );

        return;
    }

    if (!dataReady()) {

        clearReport(

            "Los datos todavía no están disponibles."
        );

        showMessage(

            "Espera la sincronización de Firebase.",

            true
        );

        return;
    }

    const type =
        reportType.value;

    if (!validTypes.includes(type)) {

        clearReport();

        showMessage(

            "Selecciona un tipo de reporte válido.",

            true
        );

        return;
    }

    const usesDates = [

        "solicitudes",

        "movimientos"

    ].includes(type);

    if (

        usesDates &&

        reportStartDate.value &&

        reportEndDate.value &&

        reportStartDate.value >
        reportEndDate.value

    ) {

        clearReport();

        showMessage(

            "La fecha inicial no puede ser posterior a la final.",

            true
        );

        return;
    }

    let headers = [];

    let rows = [];

    let totalUnits = 0;

    let totalOrders = 0;

    let totalDelivered = 0;

    let totalPending = 0;

    let completedOrders = 0;

    let partialOrders = 0;

    let pendingOrders = 0;

    let reviewOrders = 0;

    let totalValue = 0;

    let totalOrdered = 0;

    let legacyCount = 0;

    let unpricedCount = 0;

    let title = "";

    let unitsLabel =
        "Total de unidades";

    let valueLabel =
        "Costo estimado pendiente";

    // ====================================
    // REPORTE DE INVENTARIO
    // ====================================

    if (type === "inventario") {

        title =
            "Reporte de inventario general";

        unitsLabel =
            "Total de existencias";

        headers = [

            "Producto",

            "Unidad",

            "Disponible",

            "Ubicación",

            "Observaciones"
        ];

        const items = sortByName(

            products.filter(

                item => matchesUnit(
                    item,
                    type
                )
            )
        );

        rows = items.map(product => {

            totalUnits +=
                integer(product.quantity);

            return [

                product.name ?? "",

                product.unit ?? "",

                product.quantity ?? 0,

                product.location ?? "",

                product.notes ?? ""
            ];
        });
    }

    // ====================================
// REPORTE DE PEDIDOS DOCENTES
// ====================================

if (type === "solicitudes") {

    title =
        "Reporte de pedidos docentes";

    unitsLabel =
        "Total de unidades solicitadas";

    headers = [

        "Pedido",

        "Fecha",

        "Docente",

        "Unidad",

        "Material",

        "Solicitado",

        "Entregado",

        "Pendiente",

        "Estado material",

        "Estado pedido",

        "Observaciones"

    ];

    const orders = groupOrders(requests)

        .filter(order =>

            matchesUnit(order, type) &&

            matchesDate(order)

        );

    totalOrders = orders.length;

    orders.forEach(order => {

        if (order.status === "Entregada") {

            completedOrders++;

        } else if (order.status === "Parcial") {

            partialOrders++;

        } else if (order.status === "Pendiente") {

            pendingOrders++;

        } else {

            reviewOrders++;

        }

        totalUnits += order.requested;

        totalDelivered += order.delivered;

        totalPending += order.pending;

        order.items.forEach(request => {

            const notes = [

                order.generalNotes
                    ? "Pedido: " +
                      order.generalNotes
                    : "",

                request.notes
                    ? "Material: " +
                      request.notes
                    : ""

            ].filter(Boolean).join(" | ");

            rows.push([

                order.id,

                formatDate(order.createdAt),

                order.teacher,

                order.unit,

                request.productName || "—",

                request.requestedQuantity ?? "—",

                request.deliveredQuantity ?? "—",

                request.pendingQuantity ?? "—",

                request.status || "Pendiente",

                order.status,

                notes || "Sin observaciones"

            ]);

        });

    });

}

    // ====================================
    // REPORTE DE MOVIMIENTOS
    // ====================================

    if (type === "movimientos") {

        title =
            "Reporte de movimientos";

        unitsLabel =
            "Total de unidades movilizadas";

        headers = [

            "Fecha",

            "Tipo",

            "Producto",

            "Unidad",

            "Cantidad",

            "Stock anterior",

            "Stock nuevo",

            "Motivo",

            "Responsable"
        ];

        const items = sortByRecent(

            movements.filter(item =>

                matchesUnit(item, type) &&

                matchesDate(item)
            )
        );

        rows = items.map(movement => {

            totalUnits +=
                integer(movement.quantity);

            return [

                formatDate(

                    movement.createdAt ??
                    movement.date
                ),

                movement.type ?? "",

                movement.productName ?? "",

                movement.productUnit ??
                movement.unit ??
                "",

                movement.quantity ?? 0,

                movement.previousQuantity ??
                movement.previousStock ??
                "—",

                movement.newQuantity ??
                movement.newStock ??
                "—",

                movement.reason ?? "",

                movement.createdByName ||
                movement.createdByEmail ||
                "—"
            ];
        });
    }

    // ====================================
    // REPORTE DE COMPRAS
    // ====================================

    if (type === "compras") {

        title =
            "Reporte de compras y proveeduría";

        unitsLabel =
            "Total de unidades por comprar";

        headers = [

            "Material",

            "Unidad",

            "Disponible",

            "Solicitudes pendientes",

            "Por comprar",

            "Por recibir",

            "Proveedor",

            "Precio unitario",

            "Costo pendiente",

            "Estado"
        ];

        const items = sortByName(

            products.filter(

                item => matchesUnit(
                    item,
                    type
                )
            )
        );

        rows = items.map(product => {

            const purchase =
                getPurchase(product.id);

            const provider =
                getProvider(purchase?.providerId);

            const calculation =
                calculatePurchase(
                    product,
                    purchase
                );

            const missingPrice =

                !purchase ||

                typeof purchase.unitPrice !== "number" ||

                !Number.isFinite(purchase.unitPrice) ||

                purchase.unitPrice < 0;

            if (calculation.legacy) {

                legacyCount++;

            } else {

                totalUnits +=
                    calculation.toBuy;

                totalOrdered +=
                    calculation.ordered;

                if (

                    calculation.toBuy > 0 &&

                    missingPrice

                ) {

                    unpricedCount++;

                } else {

                    totalValue +=
                        calculation.total;
                }
            }

            return [

                product.name ?? "",

                product.unit ?? "",

                calculation.available,

                calculation.pending,

                calculation.legacy

                    ? "Por revisar"

                    : calculation.toBuy,

                calculation.legacy

                    ? "Por revisar"

                    : calculation.ordered,

                provider?.name ??
                "Sin proveedor",

                missingPrice

                    ? "Sin precio"

                    : money(calculation.price),

                calculation.legacy

                    ? "Por revisar"

                    : calculation.toBuy === 0

                        ? money(0)

                        : missingPrice

                            ? "Sin precio"

                            : money(calculation.total),

                calculation.status
            ];
        });
    }

    // ====================================
    // INFORMACIÓN DEL REPORTE
    // ====================================

    const selectedUnit =

        reportUnit.options[
            reportUnit.selectedIndex
        ]?.textContent ||

        "Todas";

    const dateDescription = usesDates

        ? `${reportStartDate.value || "Sin fecha inicial"} a ${reportEndDate.value || "Sin fecha final"}`

        : "Estado actual; no aplica filtro histórico.";

    const warnings = [];

    if (legacyCount > 0) {

        warnings.push(

            `${legacyCount} compras antiguas requieren revisión y no están incluidas en los totales de compra.`
        );
    }

    if (unpricedCount > 0) {

        warnings.push(

            `${unpricedCount} materiales pendientes no tienen precio válido. El costo estimado es parcial.`
        );
    }

    const summary = [

    `Unidad: ${selectedUnit}`,

    `Período: ${dateDescription}`,

    `${unitsLabel}: ${totalUnits}`

];

if (type === "solicitudes") {

    summary.push(

        `Pedidos totales: ${totalOrders}`,

        `Materiales registrados: ${rows.length}`,

        `Pedidos pendientes: ${pendingOrders}`,

        `Pedidos parciales: ${partialOrders}`,

        `Pedidos completados: ${completedOrders}`,

        `Pedidos por revisar: ${reviewOrders}`,

        `Unidades entregadas: ${totalDelivered}`,

        `Unidades pendientes: ${totalPending}`

    );

    if (reviewOrders > 0) {

        warnings.push(

            `${reviewOrders} pedidos contienen cantidades que requieren revisión. Los totales pueden ser parciales.`

        );

    }

} else {

    summary.push(

        `Registros: ${rows.length}`

    );

}

    if (type === "compras") {

        summary.push(

            `Unidades por recibir: ${totalOrdered}`,

            `${valueLabel}: ${money(totalValue)}`
        );
    }

    reportResultsTitle.textContent =
        title;

    reportResultsDescription.textContent =

        summary.join(" | ") +

        (

            warnings.length

                ? " | " + warnings.join(" ")

                : ""

        );

    reportResultCount.textContent =

    type === "solicitudes"

        ? totalOrders

        : rows.length;

reportResultCount.title =

    type === "solicitudes"

        ? "Total de pedidos"

        : "Total de registros";

    reportResultUnits.textContent =
        totalUnits;

    reportResultUnits.title =
        unitsLabel;

    reportResultValue.textContent =

    type === "compras"

        ? money(totalValue) +
            (warnings.length ? " *" : "")

        : type === "solicitudes"

            ? totalPending

            : "No aplica";

reportResultValue.title =

    type === "solicitudes"

        ? "Unidades pendientes de entrega"

        : type === "compras"

            ? "Costo estimado pendiente"

            : "No aplica";

    renderTable(headers, rows);

    generatedReport = {

        title,

        type,

        headers,

        rows,

        summary,

        warnings,

        generatedAt:
            formatCurrentDate()
    };

    updateFormAccess();

    showMessage(

        warnings.length

            ? "Reporte generado con observaciones. Revisa los avisos."

            : "Reporte generado correctamente.",

        warnings.length > 0
    );
}

generateReportButton.addEventListener(

    "click",

    generateReport
);

// ========================================
// CAMBIOS EN LOS FILTROS
// ========================================

function handleFilterChange() {

    if (!hasAdminAccess()) return;

    const hadReport =
        generatedReport !== null;

    generatedReport = null;

    const usesDates = [

        "solicitudes",

        "movimientos"

    ].includes(reportType.value);

    if (!usesDates) {

        reportStartDate.value = "";

        reportEndDate.value = "";
    }

    updateFormAccess();

    if (hadReport) {

        clearReport(

            "Los filtros cambiaron. Genera nuevamente el reporte."
        );

        showMessage(

            "Presiona Generar reporte para aplicar los nuevos filtros."
        );
    }
}

[

    reportType,

    reportUnit,

    reportStartDate,

    reportEndDate

].forEach(element => {

    element.addEventListener(

        "change",

        handleFilterChange
    );
});

// ========================================
// IMPRIMIR REPORTE
// ========================================

function printReport() {

    if (

        !hasAdminAccess() ||

        !dataReady() ||

        !generatedReport

    ) return;

    // Cerrar una vista de impresión anterior.

    if (printWindow && !printWindow.closed) {

        printWindow.close();
    }

    printWindow =
        window.open("", "_blank");

    if (!printWindow) {

        showMessage(

            "El navegador bloqueó la ventana de impresión.",

            true
        );

        return;
    }

    const {

        title,

        headers,

        rows,

        summary,

        warnings,

        generatedAt

    } = generatedReport;

    const tableHeaders = headers.map(

        header =>

            `<th>${escapeHTML(header)}</th>`

    ).join("");

    const tableRows = rows.length

        ? rows.map(values =>

            "<tr>" +

            values.map(value =>

                `<td>${escapeHTML(value)}</td>`

            ).join("") +

            "</tr>"

        ).join("")

        : `

            <tr>

                <td colspan="${headers.length}">

                    No se encontraron registros.

                </td>

            </tr>
        `;

    const summaryHTML = summary.map(item =>

        `<div>${escapeHTML(item)}</div>`

    ).join("");

    const warningHTML = warnings.map(warning =>

        `<p>${escapeHTML(warning)}</p>`

    ).join("");

    try {

        printWindow.document.open();

        printWindow.document.write(`

            <!DOCTYPE html>

            <html lang="es">

            <head>

                <meta charset="UTF-8">

                <title>

                    ${escapeHTML(title)}

                </title>

                <style>

                    * {

                        box-sizing: border-box;

                    }

                    body {

                        font-family: Arial, sans-serif;

                        padding: 10px;

                        color: #1f2937;

                        font-size: 12px;

                    }

                    .report-header {

                        border-bottom: 2px solid #334155;

                        padding-bottom: 14px;

                        margin-bottom: 18px;

                    }

                    h1 {

                        font-size: 23px;

                        margin: 0 0 8px;

                        color: #172033;

                    }

                    .subtitle {

                        font-size: 13px;

                        font-weight: bold;

                    }

                    .date {

                        font-size: 11px;

                        color: #475569;

                    }

                    .summary {

                        display: grid;

                        grid-template-columns: repeat(2, 1fr);

                        gap: 8px;

                        border: 1px solid #cbd5e1;

                        padding: 12px;

                        margin-bottom: 18px;

                    }

                    .warnings {

                        border: 1px solid #cbd5e1;

                        padding: 8px 12px;

                        margin-bottom: 15px;

                        font-size: 11px;

                    }

                    table {

                        width: 100%;

                        border-collapse: collapse;

                        margin-top: 10px;

                        font-size: 10px;

                    }

                    th, td {

                        border: 1px solid #cbd5e1;

                        padding: 7px;

                        text-align: left;

                        vertical-align: top;

                        overflow-wrap: anywhere;

                    }

                    th {

                        background: #e2e8f0;

                        font-weight: bold;

                    }

                    thead {

                        display: table-header-group;

                    }

                    tr {

                        break-inside: avoid;

                        page-break-inside: avoid;

                    }

                    .footer {

                        border-top: 1px solid #cbd5e1;

                        margin-top: 24px;

                        padding-top: 10px;

                        font-size: 10px;

                        color: #475569;

                    }

                    @page {

                        size: landscape;

                        margin: 12mm;

                    }

                    @media print {

                        body {

                            padding: 0;

                        }

                    }

                </style>

            </head>

            <body>

                <div class="report-header">

                    <h1>

                        ${escapeHTML(title)}

                    </h1>

                    <p class="subtitle">

                        Sistema de Inventario Institucional

                    </p>

                    <p class="date">

                        Generado:

                        ${escapeHTML(generatedAt)}

                    </p>

                    <p class="date">

                        Fecha de impresión:

                        ${escapeHTML(formatCurrentDate())}

                    </p>

                </div>

                <div class="summary">

                    ${summaryHTML}

                </div>

                ${warnings.length ? `

                    <div class="warnings">

                        <strong>Observaciones</strong>

                        ${warningHTML}

                    </div>

                ` : ""}

                <table>

                    <thead>

                        <tr>

                            ${tableHeaders}

                        </tr>

                    </thead>

                    <tbody>

                        ${tableRows}

                    </tbody>

                </table>

                <div class="footer">

                    Documento de uso administrativo.

                    Sistema de Inventario Institucional.

                </div>

            </body>

            </html>
        `);

        printWindow.document.close();

        printWindow.focus();

        printWindow.print();

    } catch (error) {

        console.error(

            "Error de impresión:",

            error
        );

        if (printWindow && !printWindow.closed) {

            printWindow.close();
        }

        printWindow = null;

        showMessage(

            "No se pudo preparar la impresión.",

            true
        );
    }
}

printReportButton.addEventListener(

    "click",

    printReport
);

// ========================================
// CANCELAR CONSULTAS ANTERIORES
// ========================================

function stopListeners() {

    unsubscribers.forEach(unsubscribe => {

        unsubscribe();
    });

    unsubscribers = [];
}

// ========================================
// LIMPIAR COLECCIONES
// ========================================

function clearCollection(name) {

    if (name === "productos") products = [];

    if (name === "solicitudes") requests = [];

    if (name === "movimientos") movements = [];

    if (name === "compras") purchases = [];

    if (name === "proveedores") providers = [];
}

// ========================================
// ESCUCHAR FIREBASE
// ========================================

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

            collectionErrors.delete(name);

            renderSummary();

            if (dataReady()) {

                if (generatedReport) {

                    generateReport();

                } else {

                    const result =
                        getPendingPurchaseCost();

                    if (

                        result.legacyCount > 0 ||

                        result.unpricedCount > 0

                    ) {

                        showMessage(

                            "Información disponible. El presupuesto tiene compras por revisar o materiales sin precio.",

                            true
                        );

                    } else {

                        showMessage(

                            "Información disponible. Puedes generar reportes."
                        );
                    }
                }
            }

            updateFormAccess();
        },

        error => {

            if (!validSession(revision)) return;

            console.error(

                `Error en ${name}:`,

                error
            );

            loaded.delete(name);

            collectionErrors.add(name);

            clearCollection(name);

            clearReport(

                "No fue posible consultar toda la información."
            );

            renderSummary();

            updateFormAccess();

            showMessage(

                `No se pudo cargar ${name}: ${error.message}`,

                true
            );
        }
    );

    unsubscribers.push(unsubscribe);
}

// ========================================
// REINICIAR EL MÓDULO
// ========================================

function resetModule() {

    products = [];

    requests = [];

    movements = [];

    purchases = [];

    providers = [];

    loaded.clear();

    collectionErrors.clear();

    generatedReport = null;

    if (printWindow && !printWindow.closed) {

        printWindow.close();
    }

    printWindow = null;

    reportType.value =
        "inventario";

    const allUnitsOption = Array.from(

        reportUnit.options

    ).find(option =>

        option.value.toLowerCase() === "todas"

    );

    if (allUnitsOption) {

        reportUnit.value =
            allUnitsOption.value;

    } else {

        reportUnit.selectedIndex = 0;
    }

    reportStartDate.value = "";

    reportEndDate.value = "";

    reportPurchaseCost.removeAttribute(
        "title"
    );

    renderSummary();

    clearReport(

        hasAdminAccess()

            ? "Selecciona los filtros y genera un reporte."

            : "Solo administración puede consultar los reportes."
    );

    updateFormAccess();
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
            event.detail?.user ?? null;

        isAdmin =
            event.detail?.isAdmin === true;

        resetModule();

        if (!hasAdminAccess()) {

            showMessage(

                "Solo la administradora puede consultar los reportes.",

                true
            );

            return;
        }

        showMessage(

            "Cargando información de Firebase..."
        );

        listenCollection(

            "productos",

            data => products = data,

            revision
        );

        listenCollection(

            "solicitudes",

            data => requests = data,

            revision
        );

        listenCollection(

            "movimientos",

            data => movements = data,

            revision
        );

        listenCollection(

            "compras",

            data => purchases = data,

            revision
        );

        listenCollection(

            "proveedores",

            data => providers = data,

            revision
        );
    }
);

// ========================================
// ESTADO INICIAL
// ========================================

resetModule();

showMessage(

    "Conecta una cuenta administradora."
);
