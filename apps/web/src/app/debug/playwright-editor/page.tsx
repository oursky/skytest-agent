import { notFound } from 'next/navigation';
import PlaywrightEditorRepro from '@/components/features/test-form/ui/PlaywrightEditorRepro';

export default function PlaywrightEditorDebugPage() {
    if (process.env.NODE_ENV === 'production') {
        notFound();
    }

    return <PlaywrightEditorRepro />;
}
