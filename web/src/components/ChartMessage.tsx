"use client"

import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"

type Point = { x: string | number; y: number }
type Props = {
    title?: string
    data: Point[]
}

export default function ChartMessage({ title, data }: Props) {
    return (
        <div className="w-full rounded-xl border bg-white p-3">
            {title ? <div className="mb-2 text-sm font-semibold">{title}</div> : null}
            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="y" dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
