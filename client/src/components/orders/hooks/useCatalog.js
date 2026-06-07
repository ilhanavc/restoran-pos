import { useState } from 'react';
import api from '../../../services/api.js';
import { useToast } from '../../../context/ToastContext.jsx';

export function useCatalog() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const toast = useToast();

  const loadProducts = async (catId) => {
    try {
      const prods = catId === '__all__'
        ? await api.getProducts({})
        : await api.getProducts({ category_id: catId });
      setProducts(prods);
    } catch { toast.error('Ürünler yüklenemedi'); }
  };

  const loadCategories = async () => {
    setCategoriesLoading(true);
    try {
      const cats = await api.getCategories();
      setCategories(cats);
      if (cats.length > 0) {
        setActiveCat(cats[0].id);
        loadProducts(cats[0].id);
      }
    } catch { toast.error('Kategoriler yüklenemedi'); }
    finally { setCategoriesLoading(false); }
  };

  const handleCategorySelect = (catId) => {
    setActiveCat(catId);
    setSearchQuery('');
    loadProducts(catId);
  };

  const handleSearch = async (q) => {
    setSearchQuery(q);
    if (q.length >= 2) {
      try {
        const prods = await api.getProducts({ search: q });
        setProducts(prods);
        setActiveCat(null);
      } catch {}
    } else if (q === '') {
      const catId = activeCat || categories[0]?.id;
      if (catId) {
        setActiveCat(catId);
        loadProducts(catId);
      }
    }
  };

  return {
    categories,
    products,
    activeCat,
    searchQuery,
    categoriesLoading,
    loadCategories,
    handleCategorySelect,
    handleSearch,
  };
}
