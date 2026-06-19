export function buildCaregiverPrompt(
    patientName: string,
    contextualType: string
): string {
    const readableContext = contextualType
        .toLowerCase()
        .split("_")
        .join(" ");

    return `${patientName}'s recent health pattern looks different than usual. We noticed a ${readableContext} pattern. Was anything unusual happening around this time? Select all that apply.`;
}

export function shouldShowCaregiverPrompt(params: {
    emergency: boolean;
    isAnomaly: boolean;
}): boolean {
    const { emergency, isAnomaly } = params;

    if (emergency) return false;

    return isAnomaly;
}
