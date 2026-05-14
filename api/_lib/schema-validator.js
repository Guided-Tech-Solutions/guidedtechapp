/* ================================================================
   api/_lib/schema-validator.js
   Validates user-submitted parameters or credentials against the
   service's schema definition.  Used by activate.js, save-params,
   and save-creds endpoints.
   ================================================================ */

/**
 * Validate a values object against a schema array.
 *
 * @param {Array}  schema  - array of field definitions from the service doc
 * @param {Object} values  - key/value pairs submitted by the user
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchema(schema, values = {}) {
  const errors = [];

  for (const field of schema || []) {
    const { key, label, type, required, options } = field;
    const val = values[key];
    const isEmpty = val === undefined || val === null || String(val).trim() === "";

    // Required check
    if (required && isEmpty) {
      errors.push(`"${label || key}" is required`);
      continue;
    }

    if (isEmpty) continue;   // Optional field not provided — skip type checks

    const strVal = String(val).trim();

    switch (type) {
      case "url":
        try { new URL(strVal); }
        catch { errors.push(`"${label || key}" must be a valid URL (e.g. https://example.com)`); }
        break;

      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal))
          errors.push(`"${label || key}" must be a valid email address`);
        break;

      case "number":
        if (isNaN(Number(strVal)))
          errors.push(`"${label || key}" must be a number`);
        break;

      case "select":
        if (Array.isArray(options) && !options.includes(val))
          errors.push(`"${label || key}" must be one of: ${options.join(", ")}`);
        break;

      case "multi-select":
        if (Array.isArray(options)) {
          const selected = Array.isArray(val) ? val : [val];
          const invalid  = selected.filter(v => !options.includes(v));
          if (invalid.length)
            errors.push(`"${label || key}" contains invalid options: ${invalid.join(", ")}`);
        }
        break;

      case "checkbox":
      case "toggle":
        if (typeof val !== "boolean" && val !== "true" && val !== "false" && val !== true && val !== false)
          errors.push(`"${label || key}" must be true or false`);
        break;

      case "date":
        if (isNaN(Date.parse(strVal)))
          errors.push(`"${label || key}" must be a valid date`);
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Strip any keys from values that aren't in the schema.
 * Prevents injection of unexpected fields into Firestore.
 */
function stripExtraFields(schema, values = {}) {
  const allowed = new Set((schema || []).map(f => f.key));
  const clean   = {};
  for (const [k, v] of Object.entries(values)) {
    if (allowed.has(k)) clean[k] = v;
  }
  return clean;
}

/**
 * Apply default values from schema to values object.
 */
function applyDefaults(schema, values = {}) {
  const out = { ...values };
  for (const field of schema || []) {
    if ((out[field.key] === undefined || out[field.key] === null) &&
        field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue;
    }
  }
  return out;
}

module.exports = { validateSchema, stripExtraFields, applyDefaults };
