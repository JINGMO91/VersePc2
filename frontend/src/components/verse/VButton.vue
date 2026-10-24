<script setup>
// VButton.vue — 业务按钮封装
// 业务代码只引用本组件，不直接依赖 components/ui，换组件库时只改这一层。
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const props = defineProps({
  // accent：主行动按钮；secondary：次级按钮；ghost：无底色按钮；danger：危险操作
  variant: { type: String, default: 'secondary' },
  size: { type: String, default: 'md' },
  class: { type: [String, Object, Array], default: '' },
});

const VARIANT_MAP = {
  accent: 'default',
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
};

const SIZE_MAP = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
};

const uiVariant = computed(() => VARIANT_MAP[props.variant] || 'outline');
const uiSize = computed(() => SIZE_MAP[props.size] || 'default');
</script>

<template>
  <Button :variant="uiVariant" :size="uiSize" :class="cn('v-btn', props.class)">
    <slot />
  </Button>
</template>
