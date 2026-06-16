import React from 'react';

export const AVATAR_COUNT = 9;

export default function AvatarIcon({ icon = 0, size = 36 }) {
  const idx = Math.max(0, Math.min(AVATAR_COUNT - 1, parseInt(icon) || 0));

  return (
    <img
      src={`/avatars/avatar_${idx}.png`}
      alt={`avatar ${idx}`}
      width={size}
      height={size}
      style={{
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
      }}
    />
  );
}
