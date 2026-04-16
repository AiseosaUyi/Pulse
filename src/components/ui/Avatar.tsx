interface AvatarProps {
  url: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { wrapper: "w-7 h-7", text: "text-xs" },
  md: { wrapper: "w-9 h-9", text: "text-sm" },
  lg: { wrapper: "w-14 h-14", text: "text-lg" },
};

export function Avatar({ url, name, size = "md" }: AvatarProps) {
  const { wrapper, text } = sizes[size];
  const initial = (name || "?").charAt(0).toUpperCase();

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        className={`${wrapper} rounded-full object-cover flex-shrink-0 border border-border`}
      />
    );
  }

  return (
    <div
      className={`${wrapper} rounded-full gradient-purple-pink flex items-center justify-center font-bold text-white flex-shrink-0 ${text}`}
    >
      {initial}
    </div>
  );
}
