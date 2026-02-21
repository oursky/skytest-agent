import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function PATCH() {
    return NextResponse.json(
        { error: 'AVD profiles are managed by system runtime inventory and cannot be edited manually.' },
        { status: 405 }
    );
}

export async function DELETE() {
    return NextResponse.json(
        { error: 'AVD profiles are managed by system runtime inventory and cannot be deleted manually.' },
        { status: 405 }
    );
}
