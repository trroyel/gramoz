import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addressesApi, CreateAddressDto, UpdateAddressDto } from '@/lib/api/addresses';
import { toast } from 'sonner';

export const useAddresses = () => {
  return useQuery({
    queryKey: ['addresses'],
    queryFn: async () => {
      const res = await addressesApi.getAddresses();
      if (!res.success || !res.data) throw new Error('Failed to fetch addresses');
      return res.data;
    },
  });
};

export const useCreateAddress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAddressDto) => addressesApi.createAddress(data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Address created successfully');
        queryClient.invalidateQueries({ queryKey: ['addresses'] });
      }
    },
    onError: () => {
      toast.error('Failed to create address');
    },
  });
};

export const useUpdateAddress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAddressDto }) =>
      addressesApi.updateAddress(id, data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Address updated successfully');
        queryClient.invalidateQueries({ queryKey: ['addresses'] });
      }
    },
    onError: () => {
      toast.error('Failed to update address');
    },
  });
};

export const useDeleteAddress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesApi.deleteAddress(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Address deleted successfully');
        queryClient.invalidateQueries({ queryKey: ['addresses'] });
      }
    },
    onError: () => {
      toast.error('Failed to delete address');
    },
  });
};

export const useSetDefaultAddress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesApi.setDefaultAddress(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Default address updated');
        queryClient.invalidateQueries({ queryKey: ['addresses'] });
      }
    },
    onError: () => {
      toast.error('Failed to set default address');
    },
  });
};
