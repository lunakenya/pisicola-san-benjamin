// Solo formato de fecha/hora para Guayaquil
export function nowGuayaquil() {
    return new Intl.DateTimeFormat('es-EC', {
        timeZone: 'America/Guayaquil',
        dateStyle: 'medium',
        timeStyle: 'medium',
        hour12: false,
    }).format(new Date());
}
