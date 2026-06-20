import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { categoriesApi } from '@/lib/api/categories';
import { toast } from 'sonner';

export const useCategories = () => {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await categoriesApi.getAll();
      if (!res.success || !res.data) throw new Error('Failed to fetch categories');
      return res.data;
    },
  });
};

export const useCreateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) => categoriesApi.create(data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Category created successfully');
        queryClient.invalidateQueries({ queryKey: ['categories'] });
      }
    },
    onError: () => {
      toast.error('Failed to create category');
    },
  });
};

export const useUpdateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; slug?: string; description?: string } }) =>
      categoriesApi.update(id, data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Category updated successfully');
        queryClient.invalidateQueries({ queryKey: ['categories'] });
      }
    },
    onError: () => {
      toast.error('Failed to update category');
    },
  });
};

export const useDeleteCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Category deleted successfully');
        queryClient.invalidateQueries({ queryKey: ['categories'] });
      }
    },
    onError: () => {
      toast.error('Failed to delete category');
    },
  });
};
