# EPM Chart Builder — Executive Summary

## 1. Purpose and Product Overview

**EPM Chart Builder** is an interactive web prototype designed specifically for financial analysts. The application allows users to build flexible analytical pages (workbooks), configure financial visualizations, analyze performance dynamics, and generate reports without writing code or relying on IT specialists.

The prototype runs autonomously in the browser using realistic demo data, fully simulating the business workflow of dashboard configuration.

---

## 2. Key Analytical Capabilities

### 📊 Rich Visualization Suite
Supports 14 chart and report types covering all financial analysis requirements:

* **Classic Charts:** Column, Line, Pie, Stacked Column.
* **Dual-Axis Comparative Charts (Combo / Dual Axis):** Enable simultaneous comparison of volume metrics (e.g., Revenue in currency) and relative metrics (e.g., Margin %).
* **Financial and Specialized Reports:**
  * **Bridge / Waterfall (P&L Breakdown):** A waterfall chart for step-by-step variance analysis (from Revenue to Net Profit) with automatic subtotal reconciliation checks.
  * **Time Series with Events:** A timeline graph overlaying key corporate events (loans, payments, interest rate changes) along with textual commentary.
  * **Actual / Forecast Split:** Clear data separation into **Actual** and **Forecast** with visual zone highlighting and a unified "Split Date".
  * **Rolling Forecast / Analyst Target:** A rolling forecast chart comparing analyst target benchmarks against actual values across different observation dates (vintages).
  * **Threshold Comparison:** Performance metrics compared against risk threshold zones (Green / Yellow / Red).
  * **KPI Cards:** Compact key metric blocks featuring delta calculations and trend indicators.
  * **Small Multiples:** A grid of mini-charts with a synchronized time cursor for comparing multiple segments on a single scale.
  * **Pivot Table:** A hierarchical table supporting grouping, node expansion, and heatmaps.
  * **Markdown Widget:** Generates clear text explanations and dynamic reports derived from tabular data.

---

## 3. How Analysts Interact with the Application

1. **Unified Business Data Catalog:**
   * All dimensions and measures are presented in clear, business-friendly financial terminology.
   * Simple field mapping using Drag-and-Drop or single-click selection.

2. **Flexible Page Filters:**
   * Easily assign any dimensions (entities, scenarios, line items) as global page-level filters.
   * A mandatory global **"Split Date"** parameter to clearly delineate actual historical data from projections.

3. **Intuitive Analytical Workflow:**
   * Detailed tooltips on hover for data points, events, and variances.
   * Seamless switching between time hierarchy levels (Year → Half-Year → Quarter → Month).
   * Automated validation checks with built-in warnings for incompatible configurations.

---

## 4. Key Business Value

* **Business-First Language:** Complete elimination of raw database column names in favor of clear financial terms.
* **High Accuracy:** Built-in reconciliation checks and variance highlighting.
* **Speed and Convenience:** Rapid report assembly and clear visualization of "what-if" scenarios.
