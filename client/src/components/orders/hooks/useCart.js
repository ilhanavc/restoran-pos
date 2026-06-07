import { useState } from 'react';

export function useCart() {
  const [cartItems, setCartItems] = useState([]);

  const addItemToCart = (product, modifiers, options = {}) => {
    const quantity = options.quantity != null ? Math.max(1, Math.floor(Number(options.quantity)) || 1) : 1;
    const note = options.note != null ? String(options.note) : '';
    const portion_id = options.portion_id != null ? options.portion_id : null;
    const portion_label = options.portion_label != null ? options.portion_label : null;
    const selected_attributes = options.selected_attributes || [];
    const attrExtraPrice = options.attrExtraPrice || 0;

    const modDelta = modifiers.reduce((sum, m) => sum + (m.price_delta || 0), 0);
    const attrKey = JSON.stringify(selected_attributes);
    const existingIdx = cartItems.findIndex(
      (ci) =>
        ci.product_id === product.id &&
        (ci.portion_id || null) === (portion_id || null) &&
        JSON.stringify(ci.modifiers || []) === JSON.stringify(modifiers) &&
        JSON.stringify(ci.selected_attributes || []) === attrKey &&
        (ci.note || '') === (note || ''),
    );

    if (existingIdx >= 0) {
      setCartItems((prev) =>
        prev.map((ci, i) => (i === existingIdx ? { ...ci, quantity: ci.quantity + quantity } : ci)),
      );
    } else {
      setCartItems((prev) => [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price + modDelta + attrExtraPrice,
          base_price: product.price,
          quantity,
          modifiers,
          selected_attributes,
          note,
          category_name: product.category_name,
          portion_id,
          portion_label,
        },
      ]);
    }
  };

  const updateQuantity = (index, delta) => {
    setCartItems(prev => prev.map((ci, i) => {
      if (i !== index) return ci;
      const newQty = ci.quantity + delta;
      return newQty <= 0 ? null : { ...ci, quantity: newQty };
    }).filter(Boolean));
  };

  const removeItem = (index) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index));
  };

  const getCartQtyForProduct = (productId) =>
    cartItems
      .filter((ci) => ci.product_id === productId)
      .reduce((sum, ci) => sum + ci.quantity, 0);

  const decrementProductInCart = (productId) => {
    setCartItems((prev) => {
      const simpleIdx = prev.findIndex(
        (ci) => ci.product_id === productId &&
          JSON.stringify(ci.modifiers || []) === JSON.stringify([]) &&
          !ci.note &&
          !ci.portion_id,
      );
      const idx = simpleIdx >= 0 ? simpleIdx : prev.findIndex((ci) => ci.product_id === productId);
      if (idx < 0) return prev;
      return prev
        .map((ci, i) => {
          if (i !== idx) return ci;
          const newQty = ci.quantity - 1;
          return newQty <= 0 ? null : { ...ci, quantity: newQty };
        })
        .filter(Boolean);
    });
  };

  const applyCartLineEdit = (index, { quantity, note, effectiveProduct, portion_id, portion_label, selected_attributes, attrExtraPrice }) => {
    setCartItems((prev) => {
      const ci = prev[index];
      if (!ci) return prev;
      const modDelta = (ci.modifiers || []).reduce((s, m) => s + (m.price_delta || 0), 0);
      const extraAttr = attrExtraPrice != null ? attrExtraPrice : (ci.selected_attributes || []).reduce((s, a) => s + (a.extra_price || 0), 0);
      const updated = {
        ...ci,
        quantity,
        note,
        portion_id: portion_id ?? null,
        portion_label: portion_label ?? null,
        unit_price: Number(effectiveProduct.price) + modDelta + extraAttr,
        base_price: Number(effectiveProduct.price),
        selected_attributes: selected_attributes !== undefined ? selected_attributes : (ci.selected_attributes || []),
      };
      return prev.map((c, i) => (i === index ? updated : c));
    });
  };

  return {
    cartItems,
    setCartItems,
    addItemToCart,
    updateQuantity,
    removeItem,
    getCartQtyForProduct,
    decrementProductInCart,
    applyCartLineEdit,
  };
}
