interface SERPPreviewProps {
  title: string;
  url: string;
  description: string;
}

export function SERPPreview({ title, url, description }: SERPPreviewProps) {
  return (
    <div className="bg-white rounded-lg p-4 max-w-[500px]">
      <p className="text-[13px] text-gray-500 mb-0.5 truncate">{url}</p>
      <p className="text-[18px] text-blue-700 font-medium leading-tight mb-1 line-clamp-2 hover:underline cursor-pointer">
        {title}
      </p>
      <p className="text-[13px] text-gray-600 leading-snug line-clamp-2">
        {description}
      </p>
    </div>
  );
}
