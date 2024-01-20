const template = `no,eventtag,location,event,PV1
{{#for no, alarm in alarms_list}}{{no+1}},{{alarm.tagname}},{{alarm.location}},{{alarm.event}},{{alarm.PV1}}
{{#endfor}}`;

export function gen_alarms(CPU_list) {
    return {
        rules: CPU_list.map(CPU => {
            const alarms_list = CPU.alarms_list;
            return {
                "name": `${CPU.output_dir}/alarms.csv`,
                "tags": { alarms_list }
            };
        }),
        template,
    };
}